import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { CustomersService } from '../customers/customers.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

// Section 3.4 — "Record payment received (cash/UPI/bank transfer against
// dues)". This is the RECEIPT half of a credit sale (see
// LedgerPostingService.postBillVoucher for the SALES half): a Payment row
// here is what actually brings a customer's outstanding balance back down,
// the same way CustomersService.ledger()/outstandingStatement() already
// read it. Money-touching: flagged for human review before merge per
// CLAUDE.md, same as ExpensesService/CashCustodyService.
//
// Float-safe balance comparisons use the same epsilon convention as
// CashCustodyService/BillsService.assertBalanced().
const AMOUNT_EPSILON = 0.01;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
    private readonly ledgerPostingService: LedgerPostingService,
  ) {}

  // recordedById is a plain method arg, never read off the DTO — same
  // actor-derivation rule as ExpensesService.create()/PurchasesService.create().
  async create(customerId: string, dto: CreatePaymentDto, recordedById: string) {
    // findOne() 404s on a bad/wrong-pump id (tenant-scoped by the Prisma
    // extension) before anything else runs.
    const customer = await this.customersService.findOne(customerId);

    if (dto.billId) {
      await this.assertAmountWithinBillDue(customerId, dto.billId, dto.amount);
    }

    const payment = await this.prisma.payment.create({
      data: {
        pumpId: requireTenantContext().pumpId,
        customerId,
        amount: dto.amount,
        method: dto.method,
        reference: dto.reference,
        billId: dto.billId,
        recordedById,
      },
    });

    // Section 12 — best-effort, non-blocking (see LedgerPostingService's
    // header comment): the Payment above is already committed regardless of
    // whether this succeeds.
    await this.ledgerPostingService.postPaymentVoucher(payment, customer.name);

    return payment;
  }

  findAllForCustomer(customerId: string) {
    return this.prisma.payment.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Tally's "Agst Ref" validation: a payment allocated against a specific
  // bill can't exceed what's still actually due on THAT bill — reject
  // rather than silently let it overpay (or double-settle) one invoice
  // while the customer's aggregate balance elsewhere looks fine. This is
  // deliberately narrower than a customer-wide overpayment check: an
  // unallocated ("On Account") payment is still allowed to exceed the
  // aggregate outstanding total (an advance), same as Tally.
  private async assertAmountWithinBillDue(
    customerId: string,
    billId: string,
    amount: number,
  ): Promise<void> {
    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, customerId, deletedAt: null },
      include: { paymentLines: true },
    });
    if (!bill) {
      throw new NotFoundException(
        `Bill ${billId} not found for customer ${customerId}`,
      );
    }

    const creditIn = bill.paymentLines
      .filter((line) => line.paymentType === 'CREDIT' && line.direction === 'IN')
      .reduce((total, line) => total + line.amount, 0);
    const creditOut = bill.paymentLines
      .filter((line) => line.paymentType === 'CREDIT' && line.direction === 'OUT')
      .reduce((total, line) => total + line.amount, 0);
    const billNetCredit = creditIn - creditOut;

    if (billNetCredit <= 0) {
      throw new BadRequestException(
        `Bill ${bill.billNumber} was not sold on credit — there is nothing to repay against it`,
      );
    }

    const alreadyAllocatedAgg = await this.prisma.payment.aggregate({
      _sum: { amount: true },
      where: { billId },
    });
    const remainingDue = billNetCredit - (alreadyAllocatedAgg._sum.amount ?? 0);

    if (amount - remainingDue > AMOUNT_EPSILON) {
      throw new BadRequestException(
        `Payment of ${amount} exceeds the ${remainingDue.toFixed(2)} still due on bill ${bill.billNumber}`,
      );
    }
  }
}
