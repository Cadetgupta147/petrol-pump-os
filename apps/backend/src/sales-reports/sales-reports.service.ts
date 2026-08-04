import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { formatLocalDate, parseDateRangeStrings } from '../common/date-range.util';
import { RateMasterService } from '../rate-master/rate-master.service';
import { computeLitresSold } from '../meter-readings/compute-litres-sold.util';
import { resolveCurrentShiftWindow } from '../shift-schedule/resolve-current-shift-window';
import { aggregateByPaymentType } from '../dashboard/payment-line-aggregation.util';

type StockProvenance = 'MEASURED' | 'COMPUTED' | 'UNAVAILABLE';

export interface DsrReport {
  date: string;
  fuels: {
    productType: string;
    shifts: {
      shiftDefinitionId: string | null;
      label: string;
      litres: number;
      value: number | null; // null when no Rate Master entry covers this shift's rate lookup
    }[];
    totalLitres: number;
    totalValue: number; // sum of non-null shift values only
  }[];
  stockMovement: {
    tankId: string;
    tankNumber: string;
    productType: string;
    openingStock: number | null;
    openingStockProvenance: StockProvenance;
    receipts: number;
    sales: number;
    closingStock: number | null;
    closingStockProvenance: StockProvenance;
  }[];
  collections: { cash: number; card: number; upi: number; credit: number };
  shortExcess: number;
}

// Section 12 — "Nozzle-wise sales" and "Vehicle-wise sales" were already
// planned but never built (dashboard.service.ts's own comment explicitly
// scoped both out of its slice) — this module is that backlog item.
@Injectable()
export class SalesReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateMasterService: RateMasterService,
  ) {}

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

  // Section 12B — Daily Sales Report. Single day only (see GetDsrQueryDto).
  // Litres/value come from the METER READING (computeLitresSold), not from
  // summing Bill.litres + ShiftSalesSummary.walkInLitres — the latter is
  // already DEFINED as meter litres minus billed litres (see
  // ShiftSalesService.create()), so it's meter litres decomposed into two
  // pieces, not a second additive figure. Collections genuinely IS additive
  // across both sources — see docs/master-plan.md Section 12B.2.
  async getDailySalesReport(dateStr?: string): Promise<DsrReport> {
    const date = dateStr ? dateStr.slice(0, 10) : formatLocalDate(new Date());
    const isToday = date === formatLocalDate(new Date());
    const { start, end } = parseDateRangeStrings(date, date);

    const [meterReadings, bills, shiftSales, purchases, dipReadings, tanks, shiftDefinitions] =
      await Promise.all([
        this.prisma.meterReading.findMany({
          where: { shiftStart: { gte: start, lte: end }, closingReading: { not: null } },
          include: { nozzle: { include: { item: true } } },
        }),
        this.prisma.bill.findMany({
          where: { deletedAt: null, timestamp: { gte: start, lte: end } },
          include: { paymentLines: true },
        }),
        this.prisma.shiftSalesSummary.findMany({ where: { createdAt: { gte: start, lte: end } } }),
        this.prisma.purchaseEntry.findMany({ where: { createdAt: { gte: start, lte: end } } }),
        this.prisma.dipReading.findMany({ where: { createdAt: { gte: start, lte: end } } }),
        this.prisma.tank.findMany(),
        this.prisma.shiftDefinition.findMany({ where: { isActive: true } }),
      ]);

    // ---- Sales: per fuel, shift-wise, meter-derived litres ----
    type ShiftBucket = {
      shiftDefinitionId: string | null;
      label: string;
      litres: number;
      latestShiftEnd: Date;
    };
    const fuelShiftMap = new Map<string, Map<string, ShiftBucket>>();

    for (const reading of meterReadings) {
      if (reading.shiftEnd === null) continue; // defensive — closingReading filter should already guarantee this
      const litres = computeLitresSold(
        reading.openingReading,
        reading.closingReading,
        reading.meterRolledOver,
        reading.nozzle.rolloverAt,
      );
      if (litres === null) continue;

      const productType = reading.nozzle.item.name;
      const resolved = resolveCurrentShiftWindow(shiftDefinitions, reading.shiftStart);
      const key = resolved ? resolved.shiftDefinition.id : 'UNASSIGNED';

      if (!fuelShiftMap.has(productType)) fuelShiftMap.set(productType, new Map());
      const shiftsForFuel = fuelShiftMap.get(productType)!;
      const bucket = shiftsForFuel.get(key);
      if (bucket) {
        bucket.litres += litres;
        if (reading.shiftEnd > bucket.latestShiftEnd) bucket.latestShiftEnd = reading.shiftEnd;
      } else {
        shiftsForFuel.set(key, {
          shiftDefinitionId: resolved ? resolved.shiftDefinition.id : null,
          label: resolved ? resolved.shiftDefinition.label : 'Unassigned',
          litres,
          latestShiftEnd: reading.shiftEnd,
        });
      }
    }

    const fuels: DsrReport['fuels'] = [];
    for (const [productType, shiftsForFuel] of fuelShiftMap) {
      const shifts: DsrReport['fuels'][number]['shifts'] = [];
      let totalLitres = 0;
      let totalValue = 0;
      for (const bucket of shiftsForFuel.values()) {
        let value: number | null;
        try {
          const rate = await this.rateMasterService.getCurrentRate(productType, bucket.latestShiftEnd);
          value = bucket.litres * rate.rate;
        } catch {
          // No Rate Master entry covers this instant — surface as a gap
          // (null), same "never silently guess" philosophy as the stock-
          // movement provenance below, not a report-crashing error.
          value = null;
        }
        shifts.push({
          shiftDefinitionId: bucket.shiftDefinitionId,
          label: bucket.label,
          litres: bucket.litres,
          value,
        });
        totalLitres += bucket.litres;
        if (value !== null) totalValue += value;
      }
      fuels.push({ productType, shifts, totalLitres, totalValue });
    }

    // ---- Stock movement: per tank, same nozzle->tank / purchase->tank
    // resolution order as MeterReadingsService.deductTankStock() /
    // PurchasesService.create() — replicated, not reinvented, so this
    // report never disagrees with what actually happened to the tanks. ----
    const receiptsByTankId = new Map<string, number>();
    for (const purchase of purchases) {
      const tank = tanks.find((t) => t.productType === purchase.productType);
      if (!tank) continue;
      receiptsByTankId.set(tank.id, (receiptsByTankId.get(tank.id) ?? 0) + purchase.quantityLitres);
    }

    const salesByTankId = new Map<string, number>();
    for (const reading of meterReadings) {
      const litres = computeLitresSold(
        reading.openingReading,
        reading.closingReading,
        reading.meterRolledOver,
        reading.nozzle.rolloverAt,
      );
      if (litres === null) continue;
      const tank = reading.nozzle.tankId
        ? tanks.find((t) => t.id === reading.nozzle.tankId)
        : tanks.find((t) => t.productType === reading.nozzle.item.name);
      if (!tank) continue;
      salesByTankId.set(tank.id, (salesByTankId.get(tank.id) ?? 0) + litres);
    }

    const latestDipByTankId = new Map<string, { reading: number; createdAt: Date }>();
    for (const dip of dipReadings) {
      const existing = latestDipByTankId.get(dip.tankId);
      if (!existing || dip.createdAt > existing.createdAt) {
        latestDipByTankId.set(dip.tankId, { reading: dip.reading, createdAt: dip.createdAt });
      }
    }

    const stockMovement: DsrReport['stockMovement'] = tanks.map((tank) => {
      const receipts = receiptsByTankId.get(tank.id) ?? 0;
      const sales = salesByTankId.get(tank.id) ?? 0;
      const dip = latestDipByTankId.get(tank.id);

      let closingStock: number | null;
      let closingStockProvenance: StockProvenance;
      if (dip) {
        closingStock = dip.reading;
        closingStockProvenance = 'MEASURED';
      } else if (isToday) {
        closingStock = tank.currentStockLitres;
        closingStockProvenance = 'COMPUTED';
      } else {
        closingStock = null;
        closingStockProvenance = 'UNAVAILABLE';
      }

      // Opening = closing - receipts + sales (algebraic reversal of
      // opening + receipts - sales = closing) — mathematically identical to
      // "previous day's closing stock" without a second day's worth of
      // queries, and inherits closing's own provenance: exactly as reliable
      // as whatever closing was derived from.
      const openingStock = closingStock === null ? null : closingStock - receipts + sales;
      const openingStockProvenance: StockProvenance = closingStockProvenance;

      return {
        tankId: tank.id,
        tankNumber: tank.tankNumber,
        productType: tank.productType,
        openingStock,
        openingStockProvenance,
        receipts,
        sales,
        closingStock,
        closingStockProvenance,
      };
    });

    // ---- Collections: additive across Bill payment lines + ShiftSalesSummary ----
    const billPaymentTotals = aggregateByPaymentType(bills.flatMap((b) => b.paymentLines));
    const collections = {
      cash: billPaymentTotals.CASH + shiftSales.reduce((sum, s) => sum + s.walkInCashCollected, 0),
      card: billPaymentTotals.CARD + shiftSales.reduce((sum, s) => sum + s.walkInCardCollected, 0),
      upi: billPaymentTotals.UPI + shiftSales.reduce((sum, s) => sum + s.walkInUpiCollected, 0),
      credit: billPaymentTotals.CREDIT,
    };

    // ---- Short/Excess: purely a walk-in concept (§12B.2) — a Bill's
    // payment always balances to its own amount (Section 5A), so only
    // ShiftSalesSummary.variance ever contributes here. ----
    const shortExcess = shiftSales.reduce((sum, s) => sum + s.variance, 0);

    return { date, fuels, stockMovement, collections, shortExcess };
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
