import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DateRangeQueryDto } from '../common/dto/date-range-query.dto';
import { parseDateRangeStrings } from '../common/date-range.util';

// Section 12 — "GST-ready sales/purchase report... formatted for tax
// filing, exportable to Tally."
//
// REAL MODELING GAP — flagged explicitly, not silently resolved (per
// CLAUDE.md and the task spec for this slice): neither `Bill` nor
// `PurchaseEntry` carries a tax-rate or tax-amount field anywhere in
// schema.prisma. In India, motor fuel (MS/HSD) is actually OUTSIDE GST —
// state VAT applies instead, and this schema has no VAT modeling at all;
// only non-fuel items (lubricants, and any non-fuel PurchaseEntry) would
// genuinely fall under GST. There is also no field distinguishing "this row
// is fuel" from "this row is a taxable lubricant" — both
// Bill.productType and PurchaseEntry.productType are free-form strings, not
// an enum/category flag, so even a partial tax split can't be derived
// reliably from what's stored today.
//
// Inventing a tax percentage, or guessing a fuel/non-fuel split from the
// productType string, would be exactly the kind of undocumented
// money-adjacent guess CLAUDE.md says not to make. This report is
// therefore built as a PLAIN SALES/PURCHASE REGISTER — date, party name,
// invoice/bill no., product, quantity, rate, amount — the same fields
// tally-export's XML builder already maps Bill -> Sales Voucher /
// PurchaseEntry -> Purchase Voucher from (see tally-xml-builder.util.ts).
// A real tax-rate breakup needs an actual schema/business decision (at
// minimum a product-category flag, likely a tax-rate table) before it can
// be added — see this module's handback notes.
@Injectable()
export class SalesPurchaseRegisterService {
  constructor(private readonly prisma: PrismaService) {}

  async getRegister(dto: DateRangeQueryDto) {
    const { start, end } = parseDateRangeStrings(dto.from, dto.to);

    const [bills, purchases] = await Promise.all([
      this.prisma.bill.findMany({
        where: { deletedAt: null, timestamp: { gte: start, lte: end } },
        include: { customer: { select: { name: true } } },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.purchaseEntry.findMany({
        where: { createdAt: { gte: start, lte: end } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const salesRegister = bills.map((bill) => ({
      date: bill.timestamp,
      partyName:
        bill.customer?.name ?? bill.customerName ?? 'Walk-in / cash sale',
      // Bill has no separate human-readable invoice number field in this
      // schema — the row's own id is the only stable reference available.
      billNo: bill.id,
      product: bill.productType,
      quantityLitres: bill.litres,
      rate: bill.rateApplied,
      amount: bill.amount,
    }));

    const purchaseRegister = purchases.map((purchase) => ({
      date: purchase.createdAt,
      partyName: purchase.supplierName,
      invoiceNo: purchase.invoiceNo ?? null,
      product: purchase.productType,
      quantityLitres: purchase.quantityLitres,
      rate: purchase.ratePerLitre,
      amount: purchase.amount,
    }));

    return {
      from: start,
      to: end,
      salesRegister,
      salesTotals: {
        quantityLitres: sumBy(salesRegister, (row) => row.quantityLitres),
        amount: sumBy(salesRegister, (row) => row.amount),
      },
      purchaseRegister,
      purchaseTotals: {
        quantityLitres: sumBy(purchaseRegister, (row) => row.quantityLitres),
        amount: sumBy(purchaseRegister, (row) => row.amount),
      },
      // Surfaced loudly in the response itself, not just a code comment —
      // same "don't silently absorb a gap" spirit as
      // MeterReadingsService.closeShift()'s tankWarning /
      // BillsService.create()'s loyaltyWarning fields.
      taxModelingGap:
        'No tax-rate/tax-amount breakup is included. Neither Bill nor PurchaseEntry has a tax field in the schema; fuel (MS/HSD) is outside GST (state VAT applies, unmodeled here); and there is no product-category flag distinguishing taxable lubricants from non-taxable fuel rows. This is a plain sales/purchase register, not a GST-filed tax breakup — see SalesPurchaseRegisterService for the full writeup.',
    };
  }
}

function sumBy<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((sum, item) => sum + selector(item), 0);
}
