import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { formatLocalDate, parseDateRangeStrings } from '../common/date-range.util';

// Section 12 — "Nozzle-wise sales" and "Vehicle-wise sales" were already
// planned but never built (dashboard.service.ts's own comment explicitly
// scoped both out of its slice) — this module is that backlog item.
@Injectable()
export class SalesReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // Section 12 — "Sales broken down per nozzle." Bill.nozzleId is nullable
  // and not yet populated by every entry point (see Bill's schema comment) —
  // bills with no nozzle attributed are grouped under a explicit
  // "Unattributed" bucket rather than silently dropped, so the report's
  // total always reconciles with the plain sales-summary total for the same
  // range.
  async getNozzleWiseSales(from?: string, to?: string) {
    const { start, end } = from && to ? parseDateRangeStrings(from, to) : getStartAndEndOfToday();

    const bills = await this.prisma.bill.findMany({
      where: { deletedAt: null, timestamp: { gte: start, lte: end } },
      include: { nozzle: true },
    });

    const byNozzle = new Map<
      string,
      { nozzleId: string | null; label: string; totalLitres: number; totalAmount: number; billCount: number }
    >();

    for (const bill of bills) {
      const key = bill.nozzleId ?? 'UNATTRIBUTED';
      const existing = byNozzle.get(key);
      if (existing) {
        existing.totalLitres += bill.litres;
        existing.totalAmount += bill.amount;
        existing.billCount += 1;
      } else {
        byNozzle.set(key, {
          nozzleId: bill.nozzleId,
          label: bill.nozzle?.label ?? 'Unattributed (no nozzle on bill)',
          totalLitres: bill.litres,
          totalAmount: bill.amount,
          billCount: 1,
        });
      }
    }

    const rows = [...byNozzle.values()].sort((a, b) => b.totalAmount - a.totalAmount);

    return {
      from: formatLocalDate(start),
      to: formatLocalDate(end),
      rows,
      totalLitres: rows.reduce((total, row) => total + row.totalLitres, 0),
      totalAmount: rows.reduce((total, row) => total + row.totalAmount, 0),
    };
  }

  // Section 12 — "Which vehicles/customers generate the most revenue."
  // Bill.vehicleNumber is independently optional (Section 4's bill-entry
  // validation rule only requires vehicle-OR-name) — bills with no vehicle
  // on file are grouped under an explicit bucket, same reasoning as above.
  async getVehicleWiseSales(from?: string, to?: string) {
    const { start, end } = from && to ? parseDateRangeStrings(from, to) : getStartAndEndOfToday();

    const bills = await this.prisma.bill.findMany({
      where: { deletedAt: null, timestamp: { gte: start, lte: end } },
    });

    const byVehicle = new Map<
      string,
      { vehicleNumber: string | null; customerName: string | null; totalLitres: number; totalAmount: number; billCount: number }
    >();

    for (const bill of bills) {
      const key = bill.vehicleNumber ?? `NO_VEHICLE:${bill.customerName ?? 'unknown'}`;
      const existing = byVehicle.get(key);
      if (existing) {
        existing.totalLitres += bill.litres;
        existing.totalAmount += bill.amount;
        existing.billCount += 1;
      } else {
        byVehicle.set(key, {
          vehicleNumber: bill.vehicleNumber,
          customerName: bill.customerName,
          totalLitres: bill.litres,
          totalAmount: bill.amount,
          billCount: 1,
        });
      }
    }

    const rows = [...byVehicle.values()].sort((a, b) => b.totalAmount - a.totalAmount);

    return {
      from: formatLocalDate(start),
      to: formatLocalDate(end),
      rows,
      totalLitres: rows.reduce((total, row) => total + row.totalLitres, 0),
      totalAmount: rows.reduce((total, row) => total + row.totalAmount, 0),
    };
  }
}

// Same server-local-calendar-day convention as dashboard.service.ts's own
// getStartAndEndOfToday() (see date-range.util.ts's comment on why each
// report keeps its own copy rather than sharing one).
function getStartAndEndOfToday(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}
