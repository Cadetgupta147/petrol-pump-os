import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DateRangeQueryDto } from '../common/dto/date-range-query.dto';
import { parseDateRangeStrings } from '../common/date-range.util';
import { TaxRateConfigService } from '../tax-rate-config/tax-rate-config.service';

// Section 12 — "GST-ready sales/purchase report... formatted for tax
// filing, exportable to Tally."
//
// REAL MODELING GAP, PARTIALLY CLOSED (Section 17.22) — neither `Bill` nor
// `PurchaseEntry` carries a tax-rate/tax-amount field, and both use
// free-form productType strings (no category enum), so this service still
// can't ALGORITHMICALLY tell fuel (outside GST — state VAT applies, still
// unmodeled) from a genuinely taxable lubricant/non-fuel row. Instead of
// guessing that split or inventing a rate, TaxRateConfig (Section 17.22) is
// a dealer/accountant-entered rate PER productType string they actually use
// — a productType with no configured row is treated as untaxed (e.g. every
// fuel grade, left unconfigured on purpose), not defaulted to some assumed
// percentage. taxRatePercent/taxAmount below are ADDITIVE on top of `amount`
// (amount is treated as the pre-tax/taxable value — a dealer whose
// recorded amount is already tax-inclusive needs to enter the
// correspondingly back-calculated taxable value's rate, not the headline
// GST slab — this is documented here, not silently assumed correct for
// every dealer's bookkeeping convention).
@Injectable()
export class SalesPurchaseRegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taxRateConfigService: TaxRateConfigService,
  ) {}

  async getRegister(dto: DateRangeQueryDto) {
    const { start, end } = parseDateRangeStrings(dto.from, dto.to);

    const [bills, purchases, taxRateByProduct] = await Promise.all([
      this.prisma.bill.findMany({
        where: { deletedAt: null, timestamp: { gte: start, lte: end } },
        include: { customer: { select: { name: true } } },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.purchaseEntry.findMany({
        where: { createdAt: { gte: start, lte: end } },
        orderBy: { createdAt: 'asc' },
      }),
      this.taxRateConfigService.resolveTaxRateMap(),
    ]);

    function taxFields(productType: string, amount: number) {
      const taxRatePercent = taxRateByProduct[productType] ?? null;
      return {
        taxRatePercent,
        taxAmount: taxRatePercent === null ? null : (amount * taxRatePercent) / 100,
      };
    }

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
      ...taxFields(bill.productType, bill.amount),
    }));

    const purchaseRegister = purchases.map((purchase) => ({
      date: purchase.createdAt,
      partyName: purchase.supplierName,
      invoiceNo: purchase.invoiceNo ?? null,
      product: purchase.productType,
      quantityLitres: purchase.quantityLitres,
      rate: purchase.ratePerLitre,
      amount: purchase.amount,
      ...taxFields(purchase.productType, purchase.amount),
    }));

    return {
      from: start,
      to: end,
      salesRegister,
      salesTotals: {
        quantityLitres: sumBy(salesRegister, (row) => row.quantityLitres),
        amount: sumBy(salesRegister, (row) => row.amount),
        taxAmount: sumBy(salesRegister, (row) => row.taxAmount ?? 0),
      },
      purchaseRegister,
      purchaseTotals: {
        quantityLitres: sumBy(purchaseRegister, (row) => row.quantityLitres),
        amount: sumBy(purchaseRegister, (row) => row.amount),
        taxAmount: sumBy(purchaseRegister, (row) => row.taxAmount ?? 0),
      },
      // Surfaced loudly in the response itself, not just a code comment —
      // same "don't silently absorb a gap" spirit as
      // MeterReadingsService.closeShift()'s tankWarning /
      // BillsService.create()'s loyaltyWarning fields. Narrower than before
      // Section 17.22: a per-product rate CAN now be configured
      // (/tax-rate-config), but the fuel/non-fuel split is still manual
      // (dealer's choice of which productTypes to configure), and rows with
      // no configured rate show taxRatePercent/taxAmount as null, not 0 —
      // "untaxed" and "unconfigured" are visually identical here on
      // purpose, since this schema still can't tell them apart.
      taxModelingGap:
        'taxRatePercent/taxAmount reflect a dealer-configured rate per product (Section 17.22, /tax-rate-config) where one exists; a product with no configured rate shows null, not 0. There is still no product-category flag distinguishing taxable lubricants from non-taxable fuel rows (Bill/PurchaseEntry productType stays free-text), so it is the dealer’s responsibility to configure a rate only for genuinely taxable products. This is still not a certified GST filing breakup — check with an accountant before relying on it for filing.',
    };
  }
}

function sumBy<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((sum, item) => sum + selector(item), 0);
}
