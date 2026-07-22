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
import { requireTenantContext } from '../common/tenant-context';
import { CreditConfigService } from '../credit-config/credit-config.service';
import {
  computeLoyaltyPoints,
  LoyaltyService,
} from '../loyalty/loyalty.service';
import { allocateQrMemberId } from '../customers/member-id';
import { RateMasterService } from '../rate-master/rate-master.service';
import { parseDateRangeStrings } from '../common/date-range.util';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { ListBillsQueryDto } from './dto/list-bills-query.dto';

// Manual bill entry — Section 3.2 (add/edit/delete parity with the DSM app),
// Section 5A (split payments), and Section 3.4A (informal quick-add
// customers + dealer-configurable credit limit enforcement). This is
// money-touching code (CLAUDE.md): flagged for human review before merge.
//
// Auth/role guards do exist and apply here: the global JwtAuthGuard
// (app.module.ts) requires a valid JWT on every route, and
// BillsController carries @Roles(Role.OWNER, Role.ACCOUNTANT), enforced by
// the global RolesGuard. No staff outside those two roles can reach this
// service via HTTP.
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
    private readonly loyaltyService: LoyaltyService,
    private readonly rateMasterService: RateMasterService,
  ) {}

  // Finding A1 (docs/production-readiness.md) — enteredById is no longer a
  // DTO field; BillsController derives it from req.user.staffId (the
  // authenticated caller) and passes it as its own argument, so a request
  // can no longer attribute bill entry to a different staff member.
  async create(dto: CreateBillDto, enteredById: string) {
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

    // Section 6.3 step 5 — points are credited at bill save. Fetch the
    // dealer's LoyaltyConfig up front (read-only); the actual crediting
    // happens inside the transaction below.
    //
    // DECISION (no LoyaltyConfig set): the bill still SUCCEEDS, with zero
    // points and no LoyaltyTransaction — billing is the pump's core revenue
    // operation and must not be blocked by an unconfigured Phase-3 loyalty
    // setting (bills exist from Phase 1; loyalty config has no default on
    // purpose, Section 17). To keep that from silently hiding
    // misconfiguration, the response carries an explicit loyaltyWarning
    // field whenever a customer-linked bill was saved without crediting.
    const loyaltyConfig = await this.loyaltyService.getConfig();

    // Section 7.4 — the server resolves rateApplied authoritatively from
    // Rate Master rather than trusting a client-supplied value (CLAUDE.md:
    // "never trust the frontend" applies directly to money fields). Left to
    // propagate uncaught: a bill cannot be created for a product with no
    // active Rate Master entry, full stop (same hard-block precedent as
    // PurchasesService.create()'s missing-Tank 404 — see RateMasterService.
    // getCurrentRate()). Contrast with update(), which still accepts a
    // manual rateApplied override — see UpdateBillDto's comment for why that
    // asymmetry is intentional.
    const resolvedRate = await this.rateMasterService.getCurrentRate(
      dto.productType,
    );

    // Bill + its BillPaymentLine rows (and, for quick-add, the new Customer
    // row and/or the CreditLimitAlert row, and the LoyaltyTransaction) are
    // created together in one transaction, alongside a BillAuditLog(CREATED)
    // snapshot row — nothing here should ever be left partially committed;
    // a bill and its loyalty transaction can never diverge.
    try {
      const [bill] = await this.prisma.$transaction(async (tx) => {
        // Phase 0.3 (docs/multi-tenancy-plan.md): pumpId is now a REQUIRED
        // field on every one of these models' Prisma input types (flipped
        // from nullable once Phase 2's extension guaranteed it's always
        // supplied), so TypeScript needs it stamped explicitly on every
        // `data` object below even though the extension would also inject
        // it at runtime for top-level creates — explicit-and-correct is
        // simpler than a type-cast workaround, and it's the only option at
        // all for the nested paymentLines write (see that comment below).
        const pumpId = requireTenantContext().pumpId;
        let resolvedCustomerId = dto.customerId;

        if (isQuickAdd) {
          // No accountId — a quick-add customer has no phone (Section
          // 3.4A), so there's nothing to link an account to yet; the
          // verification upgrade path (CustomersService.update())
          // creates/links one once a phone is added. allocateQrMemberId()
          // still needs pumpId passed explicitly, since Pump/
          // MemberIdCounter lookups aren't tenant-scoped the same way
          // (Pump IS the tenant root).
          const quickAddedCustomer = await tx.customer.create({
            data: {
              pumpId,
              name: dto.quickAddCustomer!.name,
              vehicleNumber: dto.quickAddCustomer!.vehicleNumber,
              verificationStatus: 'INFORMAL',
              creditLimit: creditConfig.defaultInformalCreditLimit,
              // Section 6.1/6.7 — same member-id generator as the normal
              // /customers onboarding path, same transaction as the create.
              qrMemberId: await allocateQrMemberId(tx, pumpId),
            },
          });
          resolvedCustomerId = quickAddedCustomer.id;
        }

        // Section 6.2/6.3 — points for customer-linked bills only (walk-ins
        // earn nothing). Same computeLoyaltyPoints() as the preview
        // endpoint: override-then-default precedence, dealer-level basis.
        // A quick-added customer is brand-new, so it can't have an override.
        const loyaltyCalc =
          resolvedCustomerId && loyaltyConfig
            ? computeLoyaltyPoints({
                config: loyaltyConfig,
                loyaltyRateOverride: customer?.loyaltyRateOverride ?? null,
                amount: dto.amount,
                litres: dto.litres,
              })
            : null;

        // Phase 2 (docs/multi-tenancy-plan.md) — a KNOWN NUANCE of the
        // tenant-scoping extension, found live against the real dev DB: it
        // intercepts top-level model operations (Bill.create below gets
        // pumpId auto-stamped correctly even without the explicit value
        // here), but NOT nested relation writes performed as part of that
        // same call — Prisma resolves `paymentLines: { create: [...] }`
        // internally without routing each nested row through
        // $allOperations as its own BillPaymentLine "create". So
        // BillPaymentLine.pumpId below MUST be stamped explicitly — it's
        // the only one of these that's load-bearing at runtime, not just
        // to satisfy TypeScript.
        const created = await tx.bill.create({
          data: {
            pumpId,
            customerId: resolvedCustomerId,
            vehicleNumber: dto.vehicleNumber,
            customerName: dto.customerName,
            amount: dto.amount,
            litres: dto.litres,
            productType: dto.productType,
            nozzleId: dto.nozzleId,
            rateApplied: resolvedRate.rate,
            enteredById,
            entryChannel: dto.entryChannel,
            loyaltyPointsEarned: loyaltyCalc?.points ?? 0,
            loyaltyBasisUsed: loyaltyCalc?.basis ?? null,
            paymentLines: {
              create: dto.paymentLines.map((line) => ({
                pumpId,
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

        // The customer's points balance is derived (sum of pointsDelta), not
        // stored — so this row IS the credit. Zero-point calculations (e.g.
        // an override of 0) still stamp the bill's loyalty fields above but
        // add no ledger row: an empty delta in a points ledger is noise.
        if (loyaltyCalc && loyaltyCalc.points !== 0) {
          await tx.loyaltyTransaction.create({
            data: {
              pumpId,
              customerId: resolvedCustomerId!,
              billId: created.id,
              pointsDelta: loyaltyCalc.points,
              reason: 'EARNED_ON_BILL',
            },
          });
        }

        await tx.billAuditLog.create({
          data: {
            pumpId,
            billId: created.id,
            action: 'CREATED',
            performedById: enteredById,
            snapshot: created,
          },
        });

        if (alert) {
          await tx.creditLimitAlert.create({
            data: {
              pumpId,
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

      // The loud part of the no-config decision (see above): a
      // customer-linked bill that earned nothing because loyalty is
      // unconfigured says so explicitly instead of silently returning 0.
      if (bill.customerId && !loyaltyConfig) {
        return {
          ...bill,
          loyaltyWarning:
            'Loyalty config is not set — no points were credited for this bill. Owner: PUT /loyalty-config to enable earning.',
        };
      }
      return bill;
    } catch (error) {
      this.handlePrismaError(error, enteredById);
    }
  }

  // Section 3.2 — bill register filters (date range, customer, DSM/staff,
  // payment type, vehicle number) + opt-in pagination. A request with no
  // query params at all preserves the historical behavior (every
  // non-deleted bill, unbounded) — the dashboard's own client-side
  // today/all-time split (DashboardPage.tsx) still relies on that, and
  // fixing that unbounded-payload risk properly means giving the dashboard
  // dedicated server-aggregated endpoints, not silently truncating this
  // one's default response out from under an existing caller. limit/offset
  // are what the new Billing Register screen uses to actually page through
  // results.
  async findAll(query: ListBillsQueryDto = {}) {
    const { from, to, customerId, staffId, paymentType, vehicleNumber, limit, offset } = query;

    if (from && to) {
      const { start } = parseDateRangeStrings(from, from);
      const { end } = parseDateRangeStrings(to, to);
      if (end < start) {
        throw new BadRequestException('"to" must be on or after "from"');
      }
    }

    const where: Prisma.BillWhereInput = { deletedAt: null };

    if (from || to) {
      where.timestamp = {
        ...(from ? { gte: parseDateRangeStrings(from, from).start } : {}),
        ...(to ? { lte: parseDateRangeStrings(to, to).end } : {}),
      };
    }
    if (customerId) {
      where.customerId = customerId;
    }
    if (staffId) {
      where.enteredById = staffId;
    }
    if (vehicleNumber) {
      where.vehicleNumber = { contains: vehicleNumber, mode: 'insensitive' };
    }
    if (paymentType) {
      where.paymentLines = { some: { paymentType, direction: 'IN' } };
    }

    const [bills, total] = await this.prisma.$transaction([
      this.prisma.bill.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        include: { paymentLines: true },
        ...(limit ? { take: limit, skip: offset ?? 0 } : {}),
      }),
      this.prisma.bill.count({ where }),
    ]);

    return { bills, total };
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

  // KNOWN GAP (flagged, not silent): editing a bill does NOT recalculate
  // already-credited loyalty points — loyaltyPointsEarned/loyaltyBasisUsed
  // and the LoyaltyTransaction row stay as credited at creation, even if
  // amount/litres/customerId change. Reconciling points on edit (recompute +
  // compensating LoyaltyTransaction) is a follow-up slice; until then the
  // bill's audit trail preserves what was credited and why.
  // Finding A1 — editedById is no longer a DTO field, same reasoning as
  // create()'s enteredById above.
  async update(id: string, dto: UpdateBillDto, editedById: string) {
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
      // Phase 0.3 (docs/multi-tenancy-plan.md) — resolved once, reused for
      // every create() below (BillPaymentLine's nested write is the only
      // one that's load-bearing at runtime — see the comment there; the
      // rest just need it to satisfy TypeScript now that pumpId is
      // required on these input types).
      const pumpId = requireTenantContext().pumpId;
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
            lastEditedById: editedById,
            lastEditedAt: new Date(),
            // Phase 2 (docs/multi-tenancy-plan.md) — pumpId is stamped
            // explicitly here for the same reason as create() above:
            // nested relation writes don't route through the tenant-
            // scoping extension's per-model interception.
            ...(dto.paymentLines
              ? {
                  paymentLines: {
                    create: dto.paymentLines.map((line) => ({
                      pumpId,
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
            pumpId,
            billId: updated.id,
            action: 'EDITED',
            performedById: editedById,
            snapshot: updated,
          },
        });

        if (alert) {
          await tx.creditLimitAlert.create({
            data: {
              pumpId,
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
      this.handlePrismaError(error, editedById);
    }
  }

  // KNOWN GAP (flagged, not silent): soft-deleting a bill does NOT reverse
  // its credited loyalty points — the earn-side LoyaltyTransaction survives,
  // so a deleted bill's points remain in the customer's balance. A
  // compensating negative LoyaltyTransaction on delete is a follow-up slice
  // (same one as the edit gap above).
  // Finding A1 — deletedById is no longer a DTO field, same reasoning as
  // create()/update() above.
  async remove(id: string, deletedById: string) {
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
      const pumpId = requireTenantContext().pumpId;
      const [bill] = await this.prisma.$transaction(async (tx) => {
        const deleted = await tx.bill.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            deletedById,
          },
          include: { paymentLines: true },
        });

        await tx.billAuditLog.create({
          data: {
            pumpId,
            billId: deleted.id,
            action: 'DELETED',
            performedById: deletedById,
            snapshot: deleted,
          },
        });

        return [deleted];
      });
      return bill;
    } catch (error) {
      this.handlePrismaError(error, deletedById);
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
        // Foreign key violation. Usually the actor id (enteredById /
        // editedById / deletedById) doesn't reference a real Staff record
        // (customerId is already checked explicitly above) — but as of the
        // optional nozzleId field, it can also be a bad nozzleId, so check
        // the violated constraint's field name rather than always blaming
        // the actor.
        const fieldName = (error.meta as { field_name?: string } | undefined)?.field_name ?? '';
        if (fieldName.includes('nozzleId')) {
          throw new BadRequestException('nozzleId does not reference an existing Nozzle record');
        }
        throw new BadRequestException(
          `${actorId} does not reference an existing Staff record`,
        );
      }
    }
    throw error;
  }
}
