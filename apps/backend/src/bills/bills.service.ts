import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PaymentDirection,
  PaymentType,
  Customer,
  CreditConfig,
  CreditEnforcementMode,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreditConfigService } from '../credit-config/credit-config.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { DeleteBillDto } from './dto/delete-bill.dto';

// Manual bill entry — Section 3.2 (add/edit/delete parity with the DSM app),
// Section 5A (split payments), and Section 3.4A (informal quick-add
// customers + dealer-configurable credit limit enforcement). This is
// money-touching code (CLAUDE.md): flagged for human review before merge.
//
// No auth/role guards exist in this repo yet — same gap as CustomersService.
// Every endpoint here is currently open to anyone who can reach the API.
const BALANCE_EPSILON = 0.01;

type EffectivePaymentLine = {
  paymentType: PaymentType;
  amount: number;
  direction: PaymentDirection;
};

// Result of evaluating a bill's credit impact against a customer's limit.
// Returned by evaluateCreditLimit(); null means "no CREDIT lines on this
// bill, nothing to evaluate".
type CreditLimitEvaluation = {
  billNetCredit: number;
  outstandingBefore: number;
  limit: number;
  overage: number;
};

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditConfigService: CreditConfigService,
  ) {}

  async create(dto: CreateBillDto) {
    // Section 4 — Vehicle Number and Customer Name are each individually
    // optional, but at least one of the two must be present. Enforced here
    // regardless of what the web/DSM UI does or doesn't hide.
    const hasVehicleNumber = !!dto.vehicleNumber?.trim();
    const hasCustomerName = !!dto.customerName?.trim();
    if (!hasVehicleNumber && !hasCustomerName) {
      throw new BadRequestException(
        'At least one of vehicleNumber or customerName must be provided',
      );
    }

    // Section 5A.1 — sum(IN) - sum(OUT) across payment lines must equal
    // bill.amount. Float-safe comparison via a small epsilon, not exact
    // equality (bill amounts / payment lines are floats).
    this.assertBalanced(dto.paymentLines, dto.amount);

    // Section 3.4A — resolve how this bill relates to a Customer, BEFORE
    // touching the DB transaction. Three shapes:
    //   1. dto.customerId set -> existing-customer path (as before).
    //   2. neither set, but a CREDIT line exists + dto.quickAddCustomer set
    //      -> informal quick-add path (new).
    //   3. neither set, no CREDIT lines -> no customer link at all (walk-in,
    //      unchanged from before).
    // customerId + quickAddCustomer together, or quickAddCustomer with no
    // CREDIT line, or a CREDIT line with neither, are all rejected below.
    if (dto.customerId && dto.quickAddCustomer) {
      throw new BadRequestException(
        'Provide either customerId or quickAddCustomer, not both',
      );
    }

    const hasCreditLines = dto.paymentLines.some(
      (line) => line.paymentType === 'CREDIT',
    );

    let customer: Customer | null = null;
    let isQuickAdd = false;

    if (dto.customerId) {
      customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new NotFoundException(`Customer ${dto.customerId} not found`);
      }
    } else if (dto.quickAddCustomer) {
      if (!hasCreditLines) {
        throw new BadRequestException(
          'quickAddCustomer is only for credit bills — omit it for a non-credit walk-in',
        );
      }
      isQuickAdd = true;
    } else if (hasCreditLines) {
      throw new BadRequestException(
        'CREDIT payment lines require either an existing customerId or quickAddCustomer',
      );
    }

    // Section 3.4A — dealer-configurable enforcement mode (NOTIFY default /
    // BLOCK) + the default credit limit auto-applied to a quick-added
    // customer.
    const creditConfig = await this.creditConfigService.getOrCreate();

    const evaluation = await this.evaluateCreditLimit({
      paymentLines: dto.paymentLines,
      customer,
      isQuickAdd,
      creditConfig,
    });
    const alert = this.enforceOrPrepareAlert(
      evaluation,
      creditConfig.enforcementMode,
    );

    // Bill + its BillPaymentLine rows (and, for quick-add, the new Customer
    // row and/or the CreditLimitAlert row) are created together in one
    // transaction, alongside a BillAuditLog(CREATED) snapshot row — nothing
    // here should ever be left partially committed.
    try {
      const [bill] = await this.prisma.$transaction(async (tx) => {
        let resolvedCustomerId = dto.customerId;

        if (isQuickAdd) {
          const quickAddedCustomer = await tx.customer.create({
            data: {
              name: dto.quickAddCustomer!.name,
              vehicleNumber: dto.quickAddCustomer!.vehicleNumber,
              verificationStatus: 'INFORMAL',
              creditLimit: creditConfig.defaultInformalCreditLimit,
            },
          });
          resolvedCustomerId = quickAddedCustomer.id;
        }

        const created = await tx.bill.create({
          data: {
            customerId: resolvedCustomerId,
            vehicleNumber: dto.vehicleNumber,
            customerName: dto.customerName,
            amount: dto.amount,
            litres: dto.litres,
            productType: dto.productType,
            rateApplied: dto.rateApplied,
            enteredById: dto.enteredById,
            entryChannel: dto.entryChannel,
            // Loyalty calculation is a separate module — out of scope here.
            // loyaltyPointsEarned defaults to 0, loyaltyBasisUsed stays null.
            paymentLines: {
              create: dto.paymentLines.map((line) => ({
                paymentType: line.paymentType,
                amount: line.amount,
                direction: line.direction,
              })),
            },
          },
          // customer included so a quick-added customer's id/verificationStatus
          // is visible directly in the response, not just its id.
          include: { paymentLines: true, customer: true },
        });

        await tx.billAuditLog.create({
          data: {
            billId: created.id,
            action: 'CREATED',
            performedById: dto.enteredById,
            snapshot: created as unknown as Prisma.InputJsonValue,
          },
        });

        if (alert) {
          await tx.creditLimitAlert.create({
            data: {
              billId: created.id,
              customerId: created.customerId!,
              outstandingBefore: alert.outstandingBefore,
              billNetCredit: alert.billNetCredit,
              creditLimit: alert.limit,
              overageAmount: alert.overage,
            },
          });
        }

        return [created];
      });
      return bill;
    } catch (error) {
      this.handlePrismaError(error, dto.enteredById);
    }
  }

  findAll() {
    return this.prisma.bill.findMany({
      where: { deletedAt: null },
      orderBy: { timestamp: 'desc' },
      include: { paymentLines: true },
    });
  }

  async findOne(id: string) {
    // Soft-deleted bills are still returned here — needed for the
    // audit/detail view (Section 3.2 bill history requirement).
    const bill = await this.prisma.bill.findUnique({
      where: { id },
      include: { paymentLines: true },
    });
    if (!bill) {
      throw new NotFoundException(`Bill ${id} not found`);
    }
    return bill;
  }

  async update(id: string, dto: UpdateBillDto) {
    const existing = await this.prisma.bill.findUnique({
      where: { id },
      include: { paymentLines: true },
    });
    if (!existing) {
      throw new NotFoundException(`Bill ${id} not found`);
    }
    if (existing.deletedAt) {
      throw new ConflictException(
        'Bill has been deleted and cannot be edited',
      );
    }

    // Section 3.4A — quick-add is NOT supported on edit. Editing an existing
    // bill to spontaneously attach a brand-new customer is out of scope;
    // CREDIT lines on an edit still require an existing customerId, same as
    // pre-3.4A behavior. (Only create() supports quick-add.)
    if (dto.quickAddCustomer) {
      throw new BadRequestException(
        'quickAddCustomer is not supported when editing an existing bill — attach an existing customerId instead',
      );
    }

    // Effective post-edit values: dto field if provided, else existing.
    const effective = {
      vehicleNumber: dto.vehicleNumber ?? existing.vehicleNumber,
      customerName: dto.customerName ?? existing.customerName,
      amount: dto.amount ?? existing.amount,
      litres: dto.litres ?? existing.litres,
      productType: dto.productType ?? existing.productType,
      rateApplied: dto.rateApplied ?? existing.rateApplied,
      customerId:
        dto.customerId !== undefined ? dto.customerId : existing.customerId,
    };
    const effectivePaymentLines: EffectivePaymentLine[] = dto.paymentLines
      ? dto.paymentLines.map((line) => ({
          paymentType: line.paymentType,
          amount: line.amount,
          direction: line.direction,
        }))
      : existing.paymentLines.map((line) => ({
          paymentType: line.paymentType,
          amount: line.amount,
          direction: line.direction,
        }));

    // Section 4 re-validation against effective values.
    const hasVehicleNumber = !!effective.vehicleNumber?.trim();
    const hasCustomerName = !!effective.customerName?.trim();
    if (!hasVehicleNumber && !hasCustomerName) {
      throw new BadRequestException(
        'At least one of vehicleNumber or customerName must be provided',
      );
    }

    // Section 5A.1 re-validation against effective values.
    this.assertBalanced(effectivePaymentLines, effective.amount);

    // Confirm the referenced Customer actually exists (if changed / present).
    let customer: Customer | null = null;
    if (effective.customerId) {
      customer = await this.prisma.customer.findUnique({
        where: { id: effective.customerId },
      });
      if (!customer) {
        throw new NotFoundException(
          `Customer ${effective.customerId} not found`,
        );
      }
    }

    const hasCreditLines = effectivePaymentLines.some(
      (line) => line.paymentType === 'CREDIT',
    );
    if (hasCreditLines && !effective.customerId) {
      throw new BadRequestException(
        'CREDIT payment lines require an existing customerId — credit limit cannot be evaluated for a walk-in customer',
      );
    }

    // Section 3.4A credit limit re-evaluation — exclude this bill's own
    // current payment lines from the "existing outstanding" computation so
    // an edit doesn't double-count this bill's own prior credit contribution
    // against itself.
    const creditConfig = await this.creditConfigService.getOrCreate();
    const evaluation = await this.evaluateCreditLimit({
      paymentLines: effectivePaymentLines,
      customer,
      isQuickAdd: false,
      creditConfig,
      excludeBillId: id,
    });
    const alert = this.enforceOrPrepareAlert(
      evaluation,
      creditConfig.enforcementMode,
    );

    try {
      const [bill] = await this.prisma.$transaction(async (tx) => {
        if (dto.paymentLines) {
          await tx.billPaymentLine.deleteMany({ where: { billId: id } });
        }

        const updated = await tx.bill.update({
          where: { id },
          data: {
            vehicleNumber: effective.vehicleNumber,
            customerName: effective.customerName,
            amount: effective.amount,
            litres: effective.litres,
            productType: effective.productType,
            rateApplied: effective.rateApplied,
            customerId: effective.customerId,
            lastEditedById: dto.editedById,
            lastEditedAt: new Date(),
            ...(dto.paymentLines
              ? {
                  paymentLines: {
                    create: dto.paymentLines.map((line) => ({
                      paymentType: line.paymentType,
                      amount: line.amount,
                      direction: line.direction,
                    })),
                  },
                }
              : {}),
          },
          include: { paymentLines: true, customer: true },
        });

        await tx.billAuditLog.create({
          data: {
            billId: updated.id,
            action: 'EDITED',
            performedById: dto.editedById,
            snapshot: updated as unknown as Prisma.InputJsonValue,
          },
        });

        if (alert) {
          await tx.creditLimitAlert.create({
            data: {
              billId: updated.id,
              customerId: updated.customerId!,
              outstandingBefore: alert.outstandingBefore,
              billNetCredit: alert.billNetCredit,
              creditLimit: alert.limit,
              overageAmount: alert.overage,
            },
          });
        }

        return [updated];
      });
      return bill;
    } catch (error) {
      this.handlePrismaError(error, dto.editedById);
    }
  }

  async remove(id: string, dto: DeleteBillDto) {
    const existing = await this.prisma.bill.findUnique({
      where: { id },
      include: { paymentLines: true },
    });
    if (!existing) {
      throw new NotFoundException(`Bill ${id} not found`);
    }
    if (existing.deletedAt) {
      throw new ConflictException('Bill already deleted');
    }

    try {
      const [bill] = await this.prisma.$transaction(async (tx) => {
        const deleted = await tx.bill.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            deletedById: dto.deletedById,
          },
          include: { paymentLines: true },
        });

        await tx.billAuditLog.create({
          data: {
            billId: deleted.id,
            action: 'DELETED',
            performedById: dto.deletedById,
            snapshot: deleted as unknown as Prisma.InputJsonValue,
          },
        });

        return [deleted];
      });
      return bill;
    } catch (error) {
      this.handlePrismaError(error, dto.deletedById);
    }
  }

  // Section 5A.1 — sum(IN) - sum(OUT) across payment lines must equal amount.
  // Float-safe comparison via a small epsilon, not exact equality.
  private assertBalanced(
    paymentLines: EffectivePaymentLine[],
    amount: number,
  ) {
    const sumIn = paymentLines
      .filter((line) => line.direction === 'IN')
      .reduce((total, line) => total + line.amount, 0);
    const sumOut = paymentLines
      .filter((line) => line.direction === 'OUT')
      .reduce((total, line) => total + line.amount, 0);
    const net = sumIn - sumOut;

    if (Math.abs(net - amount) > BALANCE_EPSILON) {
      throw new BadRequestException(
        `Payment lines do not balance: sum(IN) - sum(OUT) = ${net.toFixed(2)}, ` +
          `but bill.amount = ${amount.toFixed(2)}`,
      );
    }
  }

  // Section 3.4A — compute this bill's net credit impact and, if non-zero,
  // how it stacks up against the relevant credit limit. Returns null when
  // there's nothing to evaluate (no CREDIT lines on this bill at all).
  //
  // Does NOT throw and does NOT create anything — purely a read/compute
  // step, shared by create() and update(). Blocking (BLOCK mode) or
  // recording an alert (NOTIFY mode) is enforceOrPrepareAlert()'s job.
  private async evaluateCreditLimit(params: {
    paymentLines: EffectivePaymentLine[];
    customer: Customer | null;
    isQuickAdd: boolean;
    creditConfig: CreditConfig;
    excludeBillId?: string;
  }): Promise<CreditLimitEvaluation | null> {
    const { paymentLines, customer, isQuickAdd, creditConfig, excludeBillId } =
      params;

    const creditIn = paymentLines
      .filter((line) => line.paymentType === 'CREDIT' && line.direction === 'IN')
      .reduce((total, line) => total + line.amount, 0);
    const creditOut = paymentLines
      .filter((line) => line.paymentType === 'CREDIT' && line.direction === 'OUT')
      .reduce((total, line) => total + line.amount, 0);
    const billNetCredit = creditIn - creditOut;

    if (billNetCredit === 0) {
      return null;
    }

    let outstandingBefore: number;
    let limit: number;

    if (isQuickAdd) {
      // Brand-new customer, nothing to query yet.
      outstandingBefore = 0;
      limit = creditConfig.defaultInformalCreditLimit;
    } else {
      // Existing-customer path — customer is guaranteed non-null here:
      // billNetCredit !== 0 implies hasCreditLines, which (for both
      // create()'s and update()'s callers) is only reachable once a real
      // customerId has already been resolved and its Customer row loaded.
      const customerId = customer!.id;
      const creditInAgg = await this.prisma.billPaymentLine.aggregate({
        _sum: { amount: true },
        where: {
          paymentType: 'CREDIT',
          direction: 'IN',
          bill: {
            customerId,
            deletedAt: null,
            ...(excludeBillId ? { id: { not: excludeBillId } } : {}),
          },
        },
      });
      const creditOutAgg = await this.prisma.billPaymentLine.aggregate({
        _sum: { amount: true },
        where: {
          paymentType: 'CREDIT',
          direction: 'OUT',
          bill: {
            customerId,
            deletedAt: null,
            ...(excludeBillId ? { id: { not: excludeBillId } } : {}),
          },
        },
      });
      const paymentsAgg = await this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { customerId },
      });

      outstandingBefore =
        (creditInAgg._sum.amount ?? 0) -
        (creditOutAgg._sum.amount ?? 0) -
        (paymentsAgg._sum.amount ?? 0);
      limit = customer!.creditLimit;
    }

    const overage = outstandingBefore + billNetCredit - limit;
    return { billNetCredit, outstandingBefore, limit, overage };
  }

  // Section 3.4A — dealer-configurable enforcement:
  //   BLOCK  -> over-limit bill is rejected at the point of sale (400).
  //   NOTIFY -> over-limit bill still succeeds; the caller uses the returned
  //             evaluation to create a CreditLimitAlert row inside the same
  //             transaction as the bill.
  // Returns null when there's nothing to flag (no evaluation, or not over
  // limit) — in that case, the caller should not create an alert.
  private enforceOrPrepareAlert(
    evaluation: CreditLimitEvaluation | null,
    enforcementMode: CreditEnforcementMode,
  ): CreditLimitEvaluation | null {
    if (!evaluation || evaluation.overage <= 0) {
      return null;
    }

    if (enforcementMode === 'BLOCK') {
      throw new BadRequestException(
        `Credit limit exceeded: existing outstanding ₹${evaluation.outstandingBefore.toFixed(2)}, ` +
          `this bill adds ₹${evaluation.billNetCredit.toFixed(2)}, limit is ₹${evaluation.limit.toFixed(2)}`,
      );
    }

    // NOTIFY — don't throw, let the caller record the alert.
    return evaluation;
  }

  private handlePrismaError(error: unknown, actorId: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        // Foreign key violation — most likely the actor id (enteredById /
        // editedById / deletedById) doesn't reference a real Staff record
        // (customerId is already checked explicitly above).
        throw new BadRequestException(
          `${actorId} does not reference an existing Staff record`,
        );
      }
    }
    throw error;
  }
}
