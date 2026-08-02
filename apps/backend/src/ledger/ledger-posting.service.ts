import { Injectable, Logger } from '@nestjs/common';
import {
  Bill,
  BillPaymentLine,
  CashCustodyLog,
  DrCr,
  ExpenseEntry,
  LedgerAccount,
  LedgerGroup,
  Payment,
  PaymentType,
  SystemLedgerKey,
  VoucherType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { aggregateByPaymentType } from '../dashboard/payment-line-aggregation.util';
import { allocateVoucherNumber } from './voucher-number';
import { allocateLedgerAccountCode } from './ledger-account-code';

// Section 12 Day Book — auto-posts a double-entry Voucher whenever a Bill,
// ExpenseEntry, CashCustodyLog, ShiftSalesSummary, or Payment (credit
// repayment) is created/updated elsewhere in the app (see the call sites in
// bills.service.ts, expenses.service.ts, cash-custody.service.ts,
// shift-sales.service.ts, payments.service.ts).
// This is the "hybrid" half of the ledger design (the other half is fully
// manual voucher entry, for the "BABU JI"/"TOLL"/"JEEP 0711"-style entries
// nothing else in PumpOS has data for — see vouchers.service.ts).
//
// DELIBERATELY BEST-EFFORT / NON-BLOCKING: every public method here catches
// its own errors and logs a warning instead of throwing. The Bill/
// ExpenseEntry/CashCustodyLog/ShiftSalesSummary row is the source of truth
// for its own domain (billing, expenses, cash custody, shift sales) —
// ledger posting is a DERIVED bookkeeping view on top of it. A bug in this
// service must never block a DSM from saving a bill or an Accountant from
// filing a day-end entry; it should only ever leave the ledger a step
// behind, which is visible/fixable (re-run, or enter a correcting manual
// voucher) rather than silently blocking real operational work.
//
// IDEMPOTENCY: every auto-posted Voucher carries a sourceKey
// (`bill:<id>`, `expense:<id>`, `cash-custody:<id>`, `shift-sales:<id>`,
// `payment:<id>`), unique per pump (schema.prisma). Bill/ExpenseEntry/
// CashCustodyLog/Payment are create-once, so postX() below skips if a
// voucher for that key already exists. ShiftSalesSummary is update()-able
// (manual PATCH, and the UPI webhook increments it — see KNOWN GAP below),
// so its posting method deletes-and-recreates the voucher for that
// sourceKey instead.
//
// KNOWN GAP: the UPI auto-capture webhook path (upi-webhook.service.ts's
// incrementUpiForShift()) does NOT currently call repostShiftSalesVoucher()
// — only ShiftSalesService.create()/update() do. A shift whose UPI total
// grows via webhook after this service last posted for it will show a
// stale UPI figure in the ledger until the next manual PATCH (if any).
// Flagged rather than silently left unposted — closing this gap means
// threading a posting call through the webhook's own transaction, deferred
// to keep this already-large slice bounded.
@Injectable()
export class LedgerPostingService {
  private readonly logger = new Logger(LedgerPostingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async postBillVoucher(
    bill: Bill & { paymentLines: BillPaymentLine[] },
    customerName: string | null,
  ): Promise<void> {
    try {
      const byType = aggregateByPaymentType(bill.paymentLines);
      const lines: { ledgerAccountId: string; amount: number; drCr: DrCr }[] = [];
      let total = 0;

      for (const [type, amount] of Object.entries(byType) as [PaymentType, number][]) {
        if (amount <= 0) continue;
        const ledger = await this.resolveSalesDebitLedger(bill.pumpId, type, bill.customerId, customerName);
        lines.push({ ledgerAccountId: ledger.id, amount, drCr: 'DEBIT' });
        total += amount;
      }
      if (total <= 0) return;

      const sales = await this.getOrCreateSystemLedger(bill.pumpId, 'SALES', 'Sales', 'SALES');
      lines.push({ ledgerAccountId: sales.id, amount: total, drCr: 'CREDIT' });

      await this.createVoucherIfAbsent({
        pumpId: bill.pumpId,
        sourceKey: `bill:${bill.id}`,
        date: bill.timestamp,
        voucherType: 'SALES',
        narration: `Bill ${bill.billNumber}${customerName ? ` — ${customerName}` : ''}`,
        createdById: bill.enteredById,
        lines,
      });
    } catch (error) {
      this.logger.warn(`postBillVoucher failed for bill ${bill.id}: ${String(error)}`);
    }
  }

  async postExpenseVoucher(expense: ExpenseEntry): Promise<void> {
    try {
      if (expense.amount <= 0) return;
      const category = await this.getOrCreateLedgerByName(
        expense.pumpId,
        expense.category.trim(),
        'DIRECT_EXPENSE',
      );
      const paidFrom = await this.resolvePaymentTypeLedger(
        expense.pumpId,
        expense.paidVia,
        'expense',
      );

      await this.createVoucherIfAbsent({
        pumpId: expense.pumpId,
        sourceKey: `expense:${expense.id}`,
        date: expense.expenseDate,
        voucherType: 'PAYMENT',
        narration: expense.description ? `${expense.category} — ${expense.description}` : expense.category,
        createdById: expense.recordedById,
        lines: [
          { ledgerAccountId: category.id, amount: expense.amount, drCr: 'DEBIT' },
          { ledgerAccountId: paidFrom.id, amount: expense.amount, drCr: 'CREDIT' },
        ],
      });
    } catch (error) {
      this.logger.warn(`postExpenseVoucher failed for expense ${expense.id}: ${String(error)}`);
    }
  }

  async postCashCustodyVoucher(log: CashCustodyLog, staffName: string): Promise<void> {
    try {
      const lines: { ledgerAccountId: string; amount: number; drCr: DrCr }[] = [];
      const cash = await this.getOrCreateSystemLedger(log.pumpId, 'CASH', 'Cash', 'CASH_IN_HAND');

      if (log.depositedToBank > 0) {
        const bank = await this.getOrCreateSystemLedger(log.pumpId, 'BANK_DEFAULT', 'Bank', 'BANK');
        lines.push({ ledgerAccountId: bank.id, amount: log.depositedToBank, drCr: 'DEBIT' });
        lines.push({ ledgerAccountId: cash.id, amount: log.depositedToBank, drCr: 'CREDIT' });
      }
      if (log.takenHome > 0) {
        const personal = await this.getOrCreatePersonalLedger(log.pumpId, log.handledById, staffName);
        lines.push({ ledgerAccountId: personal.id, amount: log.takenHome, drCr: 'DEBIT' });
        lines.push({ ledgerAccountId: cash.id, amount: log.takenHome, drCr: 'CREDIT' });
      }
      if (log.broughtBackToday > 0) {
        const personal = await this.getOrCreatePersonalLedger(log.pumpId, log.handledById, staffName);
        lines.push({ ledgerAccountId: cash.id, amount: log.broughtBackToday, drCr: 'DEBIT' });
        lines.push({ ledgerAccountId: personal.id, amount: log.broughtBackToday, drCr: 'CREDIT' });
      }
      if (lines.length === 0) return;

      await this.createVoucherIfAbsent({
        pumpId: log.pumpId,
        sourceKey: `cash-custody:${log.id}`,
        date: log.date,
        voucherType: 'CONTRA',
        narration: `Day-end cash reconciliation — ${staffName}`,
        createdById: log.handledById,
        lines,
      });
    } catch (error) {
      this.logger.warn(`postCashCustodyVoucher failed for log ${log.id}: ${String(error)}`);
    }
  }

  // A credit customer's repayment — the RECEIPT half of the credit-sale
  // story (see docs/master-plan.md Section 3.4 and PaymentsService.create()):
  // Dr whichever ledger the cash/card/UPI actually landed in, Cr the
  // customer's own Sundry Debtor ledger, closing out (fully or partially)
  // the receivable that bill's SALES voucher opened.
  async postPaymentVoucher(payment: Payment, customerName: string): Promise<void> {
    try {
      if (payment.amount <= 0) return;
      const received = await this.resolveReceiptDebitLedger(payment.pumpId, payment.method);
      const customer = await this.getOrCreateCustomerLedger(payment.pumpId, payment.customerId, customerName);

      await this.createVoucherIfAbsent({
        pumpId: payment.pumpId,
        sourceKey: `payment:${payment.id}`,
        date: payment.createdAt,
        voucherType: 'RECEIPT',
        narration: `Payment received from ${customerName}`,
        createdById: payment.recordedById,
        lines: [
          { ledgerAccountId: received.id, amount: payment.amount, drCr: 'DEBIT' },
          { ledgerAccountId: customer.id, amount: payment.amount, drCr: 'CREDIT' },
        ],
      });
    } catch (error) {
      this.logger.warn(`postPaymentVoucher failed for payment ${payment.id}: ${String(error)}`);
    }
  }

  // Repost (delete-then-recreate), not create-once — ShiftSalesSummary's
  // collected amounts change via PATCH (and, per the KNOWN GAP above, the
  // UPI webhook — not yet wired to call this) — see this service's header
  // comment.
  async repostShiftSalesVoucher(params: {
    pumpId: string;
    shiftSalesSummaryId: string;
    dsmId: string;
    walkInCashCollected: number;
    walkInCardCollected: number;
    walkInUpiCollected: number;
    date: Date;
  }): Promise<void> {
    try {
      const sourceKey = `shift-sales:${params.shiftSalesSummaryId}`;
      const lines: { ledgerAccountId: string; amount: number; drCr: DrCr }[] = [];
      let total = 0;

      const perType: [PaymentType, number][] = [
        ['CASH', params.walkInCashCollected],
        ['CARD', params.walkInCardCollected],
        ['UPI', params.walkInUpiCollected],
      ];
      for (const [type, amount] of perType) {
        if (amount <= 0) continue;
        const ledger = await this.resolvePaymentTypeLedger(params.pumpId, type, 'walk-in sale');
        lines.push({ ledgerAccountId: ledger.id, amount, drCr: 'DEBIT' });
        total += amount;
      }

      if (total > 0) {
        const sales = await this.getOrCreateSystemLedger(params.pumpId, 'SALES', 'Sales', 'SALES');
        lines.push({ ledgerAccountId: sales.id, amount: total, drCr: 'CREDIT' });
      }

      await this.replaceVoucher({
        pumpId: params.pumpId,
        sourceKey,
        date: params.date,
        voucherType: 'SALES',
        narration: 'Walk-in shift sales',
        createdById: params.dsmId,
        lines: total > 0 ? lines : [],
      });
    } catch (error) {
      this.logger.warn(
        `repostShiftSalesVoucher failed for shift sales ${params.shiftSalesSummaryId}: ${String(error)}`,
      );
    }
  }

  // ---------- get-or-create ledger helpers ----------

  // LedgerAccount.code (Section 12, Voucher Entry's A/C column) has to be
  // allocated BEFORE the row is created, so these four lazily-created-ledger
  // helpers switched from a blind upsert (which can't know in advance
  // whether it'll insert or no-op) to an explicit find-then-create — an
  // upsert here would burn a fresh code number on every no-op "already
  // exists" call (e.g. every single Bill posted re-touching the system Sales
  // ledger), inflating codes well past what a dealer would recognize as a
  // small stable reference list. The tiny race window this opens (two
  // concurrent first-time calls both finding nothing) is a non-issue for
  // this app's actual traffic (one pump, effectively serial requests), and
  // the existing @@unique constraints below still catch it if it ever
  // happens — see PrismaClientKnownRequestError P2002 handling anywhere
  // else in this codebase for the established pattern.
  private async getOrCreateSystemLedger(
    pumpId: string,
    key: SystemLedgerKey,
    defaultName: string,
    group: LedgerGroup,
  ): Promise<LedgerAccount> {
    const existing = await this.prisma.ledgerAccount.findUnique({
      where: { pumpId_systemKey: { pumpId, systemKey: key } },
    });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const code = await allocateLedgerAccountCode(tx, pumpId);
      return tx.ledgerAccount.create({
        data: { pumpId, code, systemKey: key, name: defaultName, group, isSystemManaged: true },
      });
    });
  }

  private async getOrCreateLedgerByName(
    pumpId: string,
    name: string,
    group: LedgerGroup,
  ): Promise<LedgerAccount> {
    const existing = await this.prisma.ledgerAccount.findUnique({
      where: { pumpId_name: { pumpId, name } },
    });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const code = await allocateLedgerAccountCode(tx, pumpId);
      return tx.ledgerAccount.create({
        data: { pumpId, code, name, group, isSystemManaged: true },
      });
    });
  }

  private async getOrCreateCustomerLedger(
    pumpId: string,
    customerId: string,
    customerName: string,
  ): Promise<LedgerAccount> {
    const existing = await this.prisma.ledgerAccount.findUnique({
      where: { linkedCustomerId: customerId },
    });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const code = await allocateLedgerAccountCode(tx, pumpId);
      return tx.ledgerAccount.create({
        data: {
          pumpId,
          code,
          name: customerName,
          group: 'SUNDRY_DEBTOR',
          isSystemManaged: true,
          linkedCustomerId: customerId,
        },
      });
    });
  }

  private async getOrCreatePersonalLedger(
    pumpId: string,
    staffId: string,
    staffName: string,
  ): Promise<LedgerAccount> {
    const existing = await this.prisma.ledgerAccount.findUnique({
      where: { linkedStaffId: staffId },
    });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const code = await allocateLedgerAccountCode(tx, pumpId);
      return tx.ledgerAccount.create({
        data: {
          pumpId,
          code,
          name: staffName,
          group: 'OTHER',
          isSystemManaged: true,
          linkedStaffId: staffId,
        },
      });
    });
  }

  private async resolveSalesDebitLedger(
    pumpId: string,
    paymentType: PaymentType,
    customerId: string | null,
    customerName: string | null,
  ): Promise<LedgerAccount> {
    switch (paymentType) {
      case 'CASH':
        return this.getOrCreateSystemLedger(pumpId, 'CASH', 'Cash', 'CASH_IN_HAND');
      case 'CARD':
        return this.getOrCreateSystemLedger(pumpId, 'CARD_CLEARING', 'Card', 'BANK');
      case 'UPI':
        return this.getOrCreateSystemLedger(pumpId, 'UPI_CLEARING', 'UPI', 'BANK');
      case 'CREDIT':
        return customerId
          ? this.getOrCreateCustomerLedger(pumpId, customerId, customerName ?? 'Credit customer')
          : this.getOrCreateSystemLedger(
              pumpId,
              'UNLINKED_CREDIT_SALES',
              'Unlinked Credit Sales',
              'SUNDRY_DEBTOR',
            );
    }
  }

  private resolvePaymentTypeLedger(
    pumpId: string,
    paymentType: PaymentType,
    context: 'expense' | 'walk-in sale',
  ): Promise<LedgerAccount> {
    switch (paymentType) {
      case 'CASH':
        return this.getOrCreateSystemLedger(pumpId, 'CASH', 'Cash', 'CASH_IN_HAND');
      case 'CARD':
        return this.getOrCreateSystemLedger(pumpId, 'CARD_CLEARING', 'Card', 'BANK');
      case 'UPI':
        return this.getOrCreateSystemLedger(pumpId, 'UPI_CLEARING', 'UPI', 'BANK');
      case 'CREDIT':
        return context === 'expense'
          ? this.getOrCreateSystemLedger(
              pumpId,
              'UNLINKED_CREDIT_EXPENSE',
              'Unlinked Credit (Expenses)',
              'SUNDRY_CREDITOR',
            )
          : this.getOrCreateSystemLedger(
              pumpId,
              'UNLINKED_CREDIT_SALES',
              'Unlinked Credit Sales',
              'SUNDRY_DEBTOR',
            );
    }
  }

  // A repayment is only ever CASH/CARD/UPI — PaymentsService.create() rejects
  // method: CREDIT before a Payment row is ever created (repaying a credit
  // due "with credit" is meaningless), so the CREDIT branch here exists only
  // so the switch stays exhaustive over PaymentType.
  private resolveReceiptDebitLedger(pumpId: string, method: PaymentType): Promise<LedgerAccount> {
    switch (method) {
      case 'CASH':
        return this.getOrCreateSystemLedger(pumpId, 'CASH', 'Cash', 'CASH_IN_HAND');
      case 'CARD':
        return this.getOrCreateSystemLedger(pumpId, 'CARD_CLEARING', 'Card', 'BANK');
      case 'UPI':
        return this.getOrCreateSystemLedger(pumpId, 'UPI_CLEARING', 'UPI', 'BANK');
      case 'CREDIT':
        throw new Error('Payment.method cannot be CREDIT');
    }
  }

  // ---------- voucher writers ----------

  private async createVoucherIfAbsent(params: {
    pumpId: string;
    sourceKey: string;
    date: Date;
    voucherType: VoucherType;
    narration: string;
    createdById: string;
    lines: { ledgerAccountId: string; amount: number; drCr: DrCr }[];
  }): Promise<void> {
    const existing = await this.prisma.voucher.findFirst({
      where: { pumpId: params.pumpId, sourceKey: params.sourceKey },
      select: { id: true },
    });
    if (existing) return;
    await this.writeVoucher(params, this.sourceFromKey(params.sourceKey));
  }

  private async replaceVoucher(params: {
    pumpId: string;
    sourceKey: string;
    date: Date;
    voucherType: VoucherType;
    narration: string;
    createdById: string;
    lines: { ledgerAccountId: string; amount: number; drCr: DrCr }[];
  }): Promise<void> {
    const existing = await this.prisma.voucher.findFirst({
      where: { pumpId: params.pumpId, sourceKey: params.sourceKey },
      select: { id: true },
    });
    if (existing) {
      // VoucherLine.voucher has onDelete: Cascade (schema.prisma) — deleting
      // the Voucher row removes its lines in the same statement.
      await this.prisma.voucher.delete({ where: { id: existing.id } });
    }
    if (params.lines.length === 0) return;
    await this.writeVoucher(params, this.sourceFromKey(params.sourceKey));
  }

  private sourceFromKey(
    sourceKey: string,
  ): 'BILL' | 'EXPENSE' | 'CASH_CUSTODY' | 'SHIFT_SALES' | 'PAYMENT' {
    const prefix = sourceKey.split(':')[0];
    switch (prefix) {
      case 'bill':
        return 'BILL';
      case 'expense':
        return 'EXPENSE';
      case 'cash-custody':
        return 'CASH_CUSTODY';
      case 'shift-sales':
        return 'SHIFT_SALES';
      case 'payment':
        return 'PAYMENT';
      default:
        throw new Error(`Unrecognized sourceKey prefix: ${sourceKey}`);
    }
  }

  private async writeVoucher(
    params: {
      pumpId: string;
      sourceKey: string;
      date: Date;
      voucherType: VoucherType;
      narration: string;
      createdById: string;
      lines: { ledgerAccountId: string; amount: number; drCr: DrCr }[];
    },
    source: 'BILL' | 'EXPENSE' | 'CASH_CUSTODY' | 'SHIFT_SALES' | 'PAYMENT',
  ): Promise<void> {
    const debitTotal = params.lines
      .filter((l) => l.drCr === 'DEBIT')
      .reduce((sum, l) => sum + l.amount, 0);
    const creditTotal = params.lines
      .filter((l) => l.drCr === 'CREDIT')
      .reduce((sum, l) => sum + l.amount, 0);
    if (Math.abs(debitTotal - creditTotal) > 0.01) {
      // Safety net, not expected to ever fire — every postX() builder above
      // constructs both sides from the same source amounts by design.
      throw new Error(
        `Auto-posted voucher for ${params.sourceKey} does not balance: Dr ${debitTotal} vs Cr ${creditTotal}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const voucherNumber = await allocateVoucherNumber(tx, params.pumpId);
      await tx.voucher.create({
        data: {
          pumpId: params.pumpId,
          voucherNumber,
          date: params.date,
          voucherType: params.voucherType,
          narration: params.narration,
          source,
          sourceKey: params.sourceKey,
          createdById: params.createdById,
          lines: {
            create: params.lines.map((line) => ({
              pumpId: params.pumpId,
              ledgerAccountId: line.ledgerAccountId,
              amount: line.amount,
              drCr: line.drCr,
            })),
          },
        },
      });
    });
  }
}
