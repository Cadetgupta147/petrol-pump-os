import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EarningBasis, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertLoyaltyConfigDto } from './dto/upsert-loyalty-config.dto';
import { CalculatePointsDto } from './dto/calculate-points.dto';

// TypeScript can't see that tenant-scoping.extension.ts injects `pumpId`
// into `where` at runtime (satisfying the `@@unique([pumpId])` constraint)
// — this cast documents that deliberately, rather than lying with `as any`.
const EMPTY_UNIQUE_WHERE = {} as Prisma.LoyaltyConfigWhereUniqueInput;

// Section 6.2 — dealer-level loyalty earning config + the points formula.
//
// Singleton-PER-PUMP pattern for LoyaltyConfig, identical to
// CreditConfigService — see that file's comment for the full story (Phase
// 2, docs/multi-tenancy-plan.md): `id` used to be pinned to a single
// hardcoded global value, which broke the moment a second pump existed.
// `id` is now a normal auto-generated cuid; `@@unique([pumpId])` is the
// real per-pump uniqueness guarantee, transparently enforced by
// tenant-scoping.extension.ts injecting `pumpId` into the (visually empty)
// where/create below. UNLIKE CreditConfig there is deliberately NO
// getOrCreate() with defaults — the launch earning basis and rate are open
// decisions (Section 17), so until the dealer explicitly PUTs a config,
// getConfig() returns null and calculatePoints() refuses with a 409 rather
// than inventing a rate.
//
// Auth/role guards do exist and apply here: the global JwtAuthGuard
// (app.module.ts) requires a valid JWT on every route, and the two
// controllers in this module carry @Roles(...) enforced by the global
// RolesGuard — config writes are Owner-only per Section 2 ("Accountant
// cannot change loyalty rates").

export type LoyaltyRateSource = 'CUSTOMER_OVERRIDE' | 'DEALER_DEFAULT';

export interface PointsCalculation {
  billId: string | null;
  customerId: string | null;
  basis: EarningBasis;
  rate: number;
  rateSource: LoyaltyRateSource;
  amount: number;
  litres: number;
  points: number;
}

// The Section 6.2 formula + rate precedence as a PURE function, so the
// preview endpoint (calculatePoints below) and the crediting path
// (BillsService.create, Section 6.3 step 5) can never drift apart:
//   RUPEE basis: points = (bill_amount / 100) × rate
//   LITRE basis: points = litres_purchased × rate
// Rate precedence (same for either basis):
//   1. loyaltyRateOverride, if set (0 is a valid override — "this customer
//      earns nothing" — only null means "not set")
//   2. otherwise config.defaultRate
// The earning basis is ALWAYS the dealer-level setting — the override
// changes the rate, never the basis. Points stay fractional (schema uses
// Float) and are kept at full precision here — this value flows straight
// into the preview response and into LoyaltyTransaction.pointsDelta /
// Bill.loyaltyPointsEarned, so rounding at this layer would bake float
// noise (or lost precision) permanently into a stored balance. Rounding to
// 2 decimals is a presentation-layer concern for whoever displays a points
// number to a human — it does not belong in this function.
export function computeLoyaltyPoints(params: {
  config: { earningBasis: EarningBasis; defaultRate: number };
  loyaltyRateOverride: number | null;
  amount: number;
  litres: number;
}): Pick<PointsCalculation, 'basis' | 'rate' | 'rateSource' | 'points'> {
  const { config, loyaltyRateOverride, amount, litres } = params;

  const rate = loyaltyRateOverride ?? config.defaultRate;
  const rateSource: LoyaltyRateSource =
    loyaltyRateOverride !== null ? 'CUSTOMER_OVERRIDE' : 'DEALER_DEFAULT';

  const raw =
    config.earningBasis === EarningBasis.RUPEE
      ? (amount / 100) * rate
      : litres * rate;

  return {
    basis: config.earningBasis,
    rate,
    rateSource,
    points: raw,
  };
}

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns null when the dealer hasn't configured loyalty yet — the
  // frontend renders that as "not configured", it is not an error.
  getConfig() {
    return this.prisma.loyaltyConfig.findUnique({
      where: EMPTY_UNIQUE_WHERE,
    });
  }

  upsertConfig(dto: UpsertLoyaltyConfigDto) {
    const data = {
      earningBasis: dto.earningBasis,
      defaultRate: dto.defaultRate,
      ...(dto.redemptionTypeAllowed !== undefined && {
        redemptionTypeAllowed: dto.redemptionTypeAllowed,
      }),
      ...(dto.customerCanChooseRedemption !== undefined && {
        customerCanChooseRedemption: dto.customerCanChooseRedemption,
      }),
      ...(dto.defaultRedemptionMode !== undefined && {
        defaultRedemptionMode: dto.defaultRedemptionMode,
      }),
      ...(dto.cashRedemptionRatio !== undefined && {
        cashRedemptionRatio: dto.cashRedemptionRatio,
      }),
      ...(dto.minRedeemablePoints !== undefined && {
        minRedeemablePoints: dto.minRedeemablePoints,
      }),
    };
    return this.prisma.loyaltyConfig.upsert({
      where: EMPTY_UNIQUE_WHERE,
      create: data,
      update: data,
    });
  }

  // Section 6.2 — the points preview endpoint. All formula/precedence logic
  // lives in computeLoyaltyPoints() above (shared with the bill-save
  // crediting path); this method only resolves the inputs server-side.
  async calculatePoints(dto: CalculatePointsDto): Promise<PointsCalculation> {
    if (
      dto.billId !== undefined &&
      (dto.amount !== undefined ||
        dto.litres !== undefined ||
        dto.customerId !== undefined)
    ) {
      throw new BadRequestException(
        'Provide either billId alone, or amount/litres/customerId — not both',
      );
    }

    let billId: string | null = null;
    let customerId: string | null;
    let amount: number;
    let litres: number;

    if (dto.billId !== undefined) {
      const bill = await this.prisma.bill.findUnique({
        where: { id: dto.billId },
      });
      if (!bill || bill.deletedAt) {
        throw new NotFoundException(`Bill ${dto.billId} not found`);
      }
      billId = bill.id;
      customerId = bill.customerId;
      amount = bill.amount;
      litres = bill.litres;
    } else {
      // ValidationPipe guarantees amount/litres are present numbers >= 0
      // whenever billId is absent (see CalculatePointsDto).
      customerId = dto.customerId ?? null;
      amount = dto.amount!;
      litres = dto.litres!;
    }

    const config = await this.getConfig();
    if (!config) {
      // No silent fallback rate/basis — both are open decisions (Section 17)
      // until the dealer explicitly configures them.
      throw new ConflictException(
        'Loyalty config is not set — the Owner must configure earning basis and default rate (PUT /loyalty-config) before points can be calculated',
      );
    }

    let loyaltyRateOverride: number | null = null;
    if (customerId !== null) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
      });
      if (!customer) {
        throw new NotFoundException(`Customer ${customerId} not found`);
      }
      loyaltyRateOverride = customer.loyaltyRateOverride;
    }

    return {
      billId,
      customerId,
      amount,
      litres,
      ...computeLoyaltyPoints({ config, loyaltyRateOverride, amount, litres }),
    };
  }

  // Section 12 — Loyalty Program Cost Report ("Points issued vs. redeemed
  // (cash + gifts) — this is a real liability, track it like one").
  //
  // JUDGMENT CALL: GiftCatalogItem has no cost-price field anywhere in
  // schema.prisma (giftName/imageUrl/pointsRequired/stockQuantity/
  // activeFlag only) — there is nowhere to read what a gift actually cost
  // the dealer to source/stock. Rather than invent a rupee figure, gift
  // redemption liability is valued the same way cash redemption liability
  // already is: in POINTS (the actual unit the dealer owes), with an
  // OPTIONAL secondary rupee-equivalent computed at the dealer's own
  // configured LoyaltyConfig.cashRedemptionRatio — that ratio is the only
  // points -> currency conversion this system has a real number for, so
  // it's reused here as a rough proxy for "what this liability is roughly
  // worth", NOT a claim that a gift's true sourcing cost equals what its
  // points would be worth if cashed out instead.
  //
  // SCOPE: this is a running BALANCE-SHEET-style snapshot (points ever
  // issued vs. ever redeemed, all-time as of now), not a period income
  // statement — no date filter, matching how
  // CashCustodyService.getReport() and TanksService.varianceReport() are
  // both point-in-time snapshots rather than range-scoped reports. A
  // period view (e.g. "points issued this month") would be a reasonable
  // follow-up but wasn't asked for here and isn't what "track it like a
  // liability" implies (a liability is a balance, not a period figure).
  async getCostReport() {
    const [issuedAgg, redeemedAgg, redemptions, config] = await Promise.all([
      this.prisma.loyaltyTransaction.aggregate({
        where: { pointsDelta: { gt: 0 } },
        _sum: { pointsDelta: true },
      }),
      this.prisma.loyaltyTransaction.aggregate({
        where: { pointsDelta: { lt: 0 } },
        _sum: { pointsDelta: true },
      }),
      this.prisma.redemptionTransaction.findMany({
        select: { redemptionType: true, pointsSpent: true, cashValue: true },
      }),
      this.getConfig(),
    ]);

    const pointsIssued = issuedAgg._sum.pointsDelta ?? 0;
    // stored negative, report positive — the `|| 0` normalizes JS's -0
    // (from -(0)) back to a plain 0 so a "no redemptions yet" pump reports
    // exactly 0, not a technically-equal-but-surprising -0.
    const pointsRedeemed = -(redeemedAgg._sum.pointsDelta ?? 0) || 0;
    const pointsOutstanding = pointsIssued - pointsRedeemed;

    const cashRedemptions = redemptions.filter(
      (r) => r.redemptionType === 'CASH',
    );
    const giftRedemptions = redemptions.filter(
      (r) => r.redemptionType === 'GIFT',
    );

    const cashRedemptionRatio = config?.cashRedemptionRatio ?? null;

    return {
      pointsIssued,
      pointsRedeemed,
      pointsOutstanding,
      redemptionBreakdown: {
        cash: {
          redemptionCount: cashRedemptions.length,
          pointsRedeemed: cashRedemptions.reduce(
            (sum, r) => sum + r.pointsSpent,
            0,
          ),
          cashValuePaidOut: cashRedemptions.reduce(
            (sum, r) => sum + (r.cashValue ?? 0),
            0,
          ),
        },
        gift: {
          redemptionCount: giftRedemptions.length,
          pointsRedeemed: giftRedemptions.reduce(
            (sum, r) => sum + r.pointsSpent,
            0,
          ),
          // Deliberately no rupee cost figure here — see the judgment-call
          // comment above (GiftCatalogItem has no cost-price field).
        },
      },
      // Valuation of the OUTSTANDING (not-yet-redeemed) points liability, at
      // the dealer's configured cash-redemption ratio — null when the
      // dealer hasn't set one, rather than a fabricated default rate.
      cashRedemptionRatio,
      outstandingLiabilityValue:
        cashRedemptionRatio !== null
          ? pointsOutstanding * cashRedemptionRatio
          : null,
    };
  }

  // Section 6.4/6.6 — a customer's current points balance: sum of
  // LoyaltyTransaction.pointsDelta for that customer (positive = earned,
  // negative = redeemed — see the schema comment on pointsDelta). This used
  // to be a private method duplicated inside RedemptionsService; pulled up
  // here as the single shared implementation (same "one pure function"
  // pattern as computeLoyaltyPoints above) so RedemptionsService's
  // redemption-eligibility checks and CustomerPortalService's home-screen
  // balance / gift-catalog affordability math can never drift apart. Never
  // stored directly on Customer — always derived on read, same reasoning as
  // CustomersService.ledger()'s outstandingBalance.
  async getBalance(customerId: string): Promise<number> {
    const agg = await this.prisma.loyaltyTransaction.aggregate({
      where: { customerId },
      _sum: { pointsDelta: true },
    });
    return agg._sum.pointsDelta ?? 0;
  }
}
