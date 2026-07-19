import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EarningBasis } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertLoyaltyConfigDto } from './dto/upsert-loyalty-config.dto';
import { CalculatePointsDto } from './dto/calculate-points.dto';

// Section 6.2 — dealer-level loyalty earning config + the points formula.
//
// Singleton pattern for LoyaltyConfig, identical to CreditConfigService: the
// row is pinned to a fixed id and written via upsert(), so at most one row
// can ever exist. UNLIKE CreditConfig there is deliberately NO getOrCreate()
// with defaults — the launch earning basis and rate are open decisions
// (Section 17), so until the dealer explicitly PUTs a config, getConfig()
// returns null and calculatePoints() refuses with a 409 rather than
// inventing a rate.
//
// Auth/role guards do exist and apply here: the global JwtAuthGuard
// (app.module.ts) requires a valid JWT on every route, and the two
// controllers in this module carry @Roles(...) enforced by the global
// RolesGuard — config writes are Owner-only per Section 2 ("Accountant
// cannot change loyalty rates").
const LOYALTY_CONFIG_ID = 'singleton';

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
      where: { id: LOYALTY_CONFIG_ID },
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
      where: { id: LOYALTY_CONFIG_ID },
      create: { id: LOYALTY_CONFIG_ID, ...data },
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
}
