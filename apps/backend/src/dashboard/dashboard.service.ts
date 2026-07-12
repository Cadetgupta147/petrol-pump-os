import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { aggregateByPaymentType } from './payment-line-aggregation.util';

// Section 3.1 (Dashboard) / Section 12 (Reports & Analytics) — deliberately
// scoped-down slice: today's sales summary, tank stock snapshot, and recent
// bills list only. The rest of the dashboard widgets (nozzle-wise sales,
// pending credit dues, staff clocked in, low stock alerts, cash custody
// status, loyalty liability) and the rest of the Section 12 report list are
// out of scope here — see the task spec.
//
// Read-only reporting — nothing here writes money/points, so it doesn't hit
// the CLAUDE.md "human review before merge" gate. Still no auth/role guards
// exist in this repo yet, same gap as BillsController/CustomersController/
// MeterReadingsController — every endpoint below is currently open to
// anyone who can reach the API.
const RECENT_BILLS_LIMIT = 20;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSalesSummary() {
    const { start, end } = getStartAndEndOfToday();

    const bills = await this.prisma.bill.findMany({
      where: {
        deletedAt: null,
        timestamp: { gte: start, lte: end },
      },
      include: { paymentLines: true },
    });

    const totalLitres = bills.reduce((total, bill) => total + bill.litres, 0);
    const totalAmount = bills.reduce((total, bill) => total + bill.amount, 0);

    const allPaymentLines = bills.flatMap((bill) => bill.paymentLines);
    const byPaymentType = aggregateByPaymentType(allPaymentLines);

    return {
      date: start.toISOString().slice(0, 10),
      totalLitres,
      totalAmount,
      byPaymentType,
    };
  }

  getTankStock() {
    return this.prisma.tank.findMany({
      select: {
        id: true,
        productType: true,
        capacityLitres: true,
        currentStockLitres: true,
        lastDipReading: true,
        lastDipAt: true,
      },
    });
  }

  async getRecentBills() {
    const bills = await this.prisma.bill.findMany({
      where: { deletedAt: null },
      orderBy: { timestamp: 'desc' },
      take: RECENT_BILLS_LIMIT,
      include: { paymentLines: true, enteredBy: true },
    });

    return bills.map((bill) => ({
      id: bill.id,
      timestamp: bill.timestamp,
      customerName: bill.customerName,
      vehicleNumber: bill.vehicleNumber,
      amount: bill.amount,
      litres: bill.litres,
      productType: bill.productType,
      entryChannel: bill.entryChannel,
      enteredBy: bill.enteredBy.name,
      byPaymentType: aggregateByPaymentType(bill.paymentLines),
    }));
  }
}

// Server-local calendar day — start/end of "today" in whatever timezone the
// backend process itself runs in (consistent with how bills.service.ts /
// meter-readings.service.ts already treat timestamps: no explicit timezone
// handling exists elsewhere in this codebase yet either).
function getStartAndEndOfToday(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
  return { start, end };
}
