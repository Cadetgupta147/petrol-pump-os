import { Injectable, Logger } from '@nestjs/common';
import {
  Bill,
  BillPaymentLine,
  CashCustodyLog,
  DrCr,
  ExpenseEntry,
  LedgerAccount,
  LedgerGroup,
  PaymentType,
  SystemLedgerKey,
  VoucherType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { aggregateByPaymentType } from '../dashboard/payment-line-aggregation.util';
import { allocateVoucherNumber } from './voucher-number';

// Section 12 Day Book — auto-posts a double-entry Voucher whenever a Bill,
// ExpenseEntry, CashCustodyLog, or ShiftSalesSummary is created/updated
// elsewhere in the app (see the call sites in bills.service.ts,
// expenses.service.ts, cash-custody.service.ts, shift-sales.service.ts).
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
// (`bill:<id>`, `expense:<id>`, `cash-custody:<id>`, `shift-sales:<id>`),
// unique per pump (schema.prisma). Bill/ExpenseEntry/CashCustodyLog are
// create-once, so postX() below skips if a voucher for that key already
// exists. ShiftSalesSummary is update()-able (manual PATCH, and the UPI
// webhook increments it — see KNOWN GAP below), so its posting method
// deletes-and-recreates the voucher for that sourceKey instead.
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

  private async getOrCreateSystemLedger(
    pumpId: string,
    key: SystemLedgerKey,
    defaultName: string,
    group: LedgerGroup,
  ): Promise<LedgerAccount> {
    return this.prisma.ledgerAccount.upsert({
      where: { pumpId_systemKey: { pumpId, systemKey: key } },
      create: { pumpId, systemKey: key, name: defaultName, group, isSystemManaged: true },
      update: {},
    });
  }

  private async getOrCreateLedgerByName(
    pumpId: string,
    name: string,
    group: LedgerGroup,
  ): Promise<LedgerAccount> {
    return this.prisma.ledgerAccount.upsert({
      where: { pumpId_name: { pumpId, name } },
      create: { pumpId, name, group, isSystemManaged: true },
      update: {},
    });
  }

  private async getOrCreateCustomerLedger(
    pumpId: string,
    customerId: string,
    customerName: string,
  ): Promise<LedgerAccount> {
    return this.prisma.ledgerAccount.upsert({
      where: { linkedCustomerId: customerId },
      create: {
        pumpId,
        name: customerName,
        group: 'SUNDRY_DEBTOR',
        isSystemManaged: true,
        linkedCustomerId: customerId,
      },
      update: {},
    });
  }

  private async getOrCreatePersonalLedger(
    pumpId: string,
    staffId: string,
    staffName: string,
  ): Promise<LedgerAccount> {
    return this.prisma.ledgerAccount.upsert({
      where: { linkedStaffId: staffId },
      create: {
        pumpId,
        name: staffName,
        group: 'OTHER',
        isSystemManaged: true,
        linkedStaffId: staffId,
      },
      update: {},
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

  private sourceFromKey(sourceKey: string): 'BILL' | 'EXPENSE' | 'CASH_CUSTODY' | 'SHIFT_SALES' {
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
    source: 'BILL' | 'EXPENSE' | 'CASH_CUSTODY' | 'SHIFT_SALES',
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
