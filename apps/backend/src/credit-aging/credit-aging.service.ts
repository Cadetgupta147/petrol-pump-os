import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { aggregateByPaymentType } from '../dashboard/payment-line-aggregation.util';
import {
  AGING_EPSILON,
  CreditLedgerEvent,
  bucketAgedSlices,
  computeFifoAgedSlices,
} from './credit-aging.util';

// Section 12 — Credit Aging Report ("who owes how long — overdue buckets
// 0-15/15-30/30+ days"). See credit-aging.util.ts for the full
// methodology/judgment-call writeup (FIFO aging).
//
// Auth: enforced at the controller level (global JwtAuthGuard + RolesGuard,
// see credit-aging.controller.ts) — Owner/Accountant per Section 12's table,
// plus Read-only per Section 2's "view dashboards and reports only".
@Injectable()
export class CreditAgingService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(asOf: Date = new Date()) {
    // Scope: only customers who have ever touched credit (a bill with a
    // CREDIT payment line) or ever made a Payment — same "who's relevant"
    // scope CustomersService.ledger() uses per-customer, just applied
    // across every customer at once instead of one at a time.
    const customers = await this.prisma.customer.findMany({
      where: {
        OR: [
          {
            bills: {
              some: { paymentLines: { some: { paymentType: 'CREDIT' } } },
            },
          },
          { payments: { some: {} } },
        ],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        creditLimit: true,
        bills: {
          where: { deletedAt: null },
          select: { timestamp: true, paymentLines: true },
        },
        payments: { select: { createdAt: true, amount: true } },
      },
    });

    const rows = customers.map((customer) => {
      const billEvents: CreditLedgerEvent[] = customer.bills.map((bill) => ({
        timestamp: bill.timestamp,
        netCreditImpact: aggregateByPaymentType(bill.paymentLines).CREDIT,
      }));
      const paymentEvents: CreditLedgerEvent[] = customer.payments.map(
        (payment) => ({
          timestamp: payment.createdAt,
          netCreditImpact: -payment.amount,
        }),
      );

      // computeFifoAgedSlices sorts internally, so pre-merge order here
      // doesn't matter.
      const slices = computeFifoAgedSlices([...billEvents, ...paymentEvents]);
      const buckets = bucketAgedSlices(slices, asOf);
      // Slices come back oldest-first (FIFO queue is only pushed at the
      // back / drained from the front) — slices[0] is the oldest still-open
      // bill, i.e. "owing since" for this customer.
      const oldestUnpaidBillDate = slices[0]?.originalTimestamp ?? null;

      return {
        customerId: customer.id,
        customerName: customer.name,
        phone: customer.phone,
        creditLimit: customer.creditLimit,
        oldestUnpaidBillDate,
        bucket0to15: buckets.bucket0to15,
        bucket15to30: buckets.bucket15to30,
        bucket30Plus: buckets.bucket30Plus,
        totalOutstanding: buckets.total,
        hasOutstandingBalance: buckets.total > AGING_EPSILON,
      };
    });

    const totals = rows.reduce(
      (acc, row) => ({
        bucket0to15: acc.bucket0to15 + row.bucket0to15,
        bucket15to30: acc.bucket15to30 + row.bucket15to30,
        bucket30Plus: acc.bucket30Plus + row.bucket30Plus,
        total: acc.total + row.totalOutstanding,
      }),
      { bucket0to15: 0, bucket15to30: 0, bucket30Plus: 0, total: 0 },
    );

    // Longest-overdue / biggest-balance customers surfaced first — meant to
    // be read top-down as "who to chase first", same ordering philosophy as
    // CashCustodyService.getReport().
    const sortedRows = rows.sort((a, b) => {
      if (a.hasOutstandingBalance !== b.hasOutstandingBalance) {
        return a.hasOutstandingBalance ? -1 : 1;
      }
      return b.totalOutstanding - a.totalOutstanding;
    });

    return { asOf, customers: sortedRows, totals };
  }
}
