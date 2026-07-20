import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoyaltyConfig, RedemptionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GiftCatalogService } from '../gift-catalog/gift-catalog.service';
import { CreateRedemptionDto } from './dto/create-redemption.dto';

// Section 6.4 (redemption policy — "entirely the dealer's call") + Section
// 6.6 (DSM-at-counter redemption flow). This is money/points-touching code
// (CLAUDE.md): flagged for human review before merge.
//
// Auth/role guards do exist and apply here: the global JwtAuthGuard
// (app.module.ts) requires a valid JWT on every route, and
// RedemptionsController carries @Roles(Role.OWNER, Role.ACCOUNTANT,
// Role.DSM), enforced by the global RolesGuard. Every rule below is
// re-derived from LoyaltyConfig/GiftCatalogItem server-side — the caller's
// redemptionType is only ever a hint that gets validated, never trusted
// outright, per CLAUDE.md ("never trust the frontend to enforce
// permissions/business rules").
@Injectable()
export class RedemptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loyaltyService: LoyaltyService,
    private readonly giftCatalogService: GiftCatalogService,
  ) {}

  async create(dto: CreateRedemptionDto) {
    const config = await this.loyaltyService.getConfig();
    if (!config) {
      throw new ConflictException(
        'Loyalty config is not set — the Owner must configure loyalty (PUT /loyalty-config) before points can be redeemed',
      );
    }
    if (!config.redemptionTypeAllowed) {
      throw new ConflictException(
        'Redemption is not configured yet — the Owner must set redemptionTypeAllowed on the loyalty config (PUT /loyalty-config)',
      );
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${dto.customerId} not found`);
    }

    const effectiveType = this.resolveEffectiveType(
      config,
      dto.redemptionType,
    );

    // Section 6.6 — balance is derived (sum of LoyaltyTransaction.pointsDelta
    // for this customer), same pattern as the earn side (BillsService /
    // LoyaltyService); it is never stored on Customer directly.
    const balance = await this.getBalance(dto.customerId);

    if (
      config.minRedeemablePoints !== null &&
      balance < config.minRedeemablePoints
    ) {
      throw new BadRequestException(
        `Customer has ${balance} points, below the minimum redeemable threshold of ${config.minRedeemablePoints}`,
      );
    }

    if (effectiveType === RedemptionType.GIFT) {
      return this.redeemGift(dto, balance);
    }
    return this.redeemCash(dto, config, balance);
  }

  // Section 6.4's three operating modes, resolved server-side from
  // LoyaltyConfig — the caller's dto.redemptionType is only ever a hint that
  // gets validated against what the dealer configured, never taken at face
  // value.
  private resolveEffectiveType(
    config: LoyaltyConfig,
    requestedType?: RedemptionType,
  ): RedemptionType {
    const allowed = config.redemptionTypeAllowed!; // caller already checked non-null

    if (allowed === RedemptionType.CASH || allowed === RedemptionType.GIFT) {
      // Mode 1 — fully dealer-controlled, single lever. A mismatched
      // request is a client bug (the frontend should never have offered a
      // choice), not something to silently override.
      if (requestedType !== undefined && requestedType !== allowed) {
        throw new BadRequestException(
          `This pump only allows ${allowed} redemptions, but ${requestedType} was requested`,
        );
      }
      return allowed;
    }

    // allowed === BOTH
    if (config.customerCanChooseRedemption) {
      // Mode 2 — fully customer-controlled: the caller must state a type.
      if (requestedType === undefined) {
        throw new BadRequestException(
          'redemptionType (CASH or GIFT) is required — this pump lets the customer choose per redemption',
        );
      }
      return requestedType;
    }

    // Mode 3 — dealer-set default, "staff can override at counter" per
    // Section 6.4's mode-3 description. KNOWN GAP: there is no
    // corresponding config field for that override (no allowStaffOverride
    // in the schema), so it is not implemented here — a mismatched
    // requestedType is always rejected rather than silently honored, which
    // is the safe (non-)default until that config field exists.
    if (!config.defaultRedemptionMode) {
      throw new ConflictException(
        'Redemption is misconfigured — redemptionTypeAllowed is BOTH with no customer choice, but defaultRedemptionMode is not set. Owner: PUT /loyalty-config to set it.',
      );
    }
    if (
      requestedType !== undefined &&
      requestedType !== config.defaultRedemptionMode
    ) {
      throw new BadRequestException(
        `This pump's fixed redemption mode is ${config.defaultRedemptionMode}, but ${requestedType} was requested`,
      );
    }
    return config.defaultRedemptionMode;
  }

  private async getBalance(customerId: string): Promise<number> {
    const agg = await this.prisma.loyaltyTransaction.aggregate({
      where: { customerId },
      _sum: { pointsDelta: true },
    });
    return agg._sum.pointsDelta ?? 0;
  }

  private async redeemGift(dto: CreateRedemptionDto, balance: number) {
    if (!dto.giftItemId) {
      throw new BadRequestException(
        'giftItemId is required for a GIFT redemption',
      );
    }

    // 404s if missing (GiftCatalogService.findOne).
    const gift = await this.giftCatalogService.findOne(dto.giftItemId);
    if (!gift.activeFlag) {
      throw new BadRequestException(
        `Gift "${gift.giftName}" has been retired and can no longer be redeemed`,
      );
    }
    if (gift.stockQuantity !== null && gift.stockQuantity <= 0) {
      throw new BadRequestException(
        `Gift "${gift.giftName}" is out of stock`,
      );
    }

    // pointsSpent for a gift is fixed by the catalog (pointsRequired) —
    // any client-supplied point amount is ignored on this branch.
    const pointsSpent = gift.pointsRequired;
    if (balance < pointsSpent) {
      throw new BadRequestException(
        `Insufficient points: customer has ${balance}, gift requires ${pointsSpent}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Re-check balance atomically inside the transaction — guards
      // against a concurrent redemption racing past the pre-check above
      // (same "server-side invariant, not just a pre-check" spirit as
      // Section 5A's split-payment balancing).
      const reAgg = await tx.loyaltyTransaction.aggregate({
        where: { customerId: dto.customerId },
        _sum: { pointsDelta: true },
      });
      const currentBalance = reAgg._sum.pointsDelta ?? 0;
      if (currentBalance < pointsSpent) {
        throw new ConflictException(
          'Insufficient points — balance changed since this redemption was requested',
        );
      }

      // Untracked stock (stockQuantity === null) never decrements and never
      // blocks — Section 6.4's "Optional — if tracked". Tracked stock uses
      // an optimistic-concurrency updateMany (decrement only succeeds if
      // stock is still > 0 in the same statement) instead of a
      // read-then-write, to avoid a race between two concurrent gift
      // redemptions both passing the pre-check above.
      if (gift.stockQuantity !== null) {
        const stockUpdate = await tx.giftCatalogItem.updateMany({
          where: { id: gift.id, stockQuantity: { gt: 0 } },
          data: { stockQuantity: { decrement: 1 } },
        });
        if (stockUpdate.count !== 1) {
          throw new ConflictException(
            `Gift "${gift.giftName}" just went out of stock`,
          );
        }
      }

      const redemption = await tx.redemptionTransaction.create({
        data: {
          customerId: dto.customerId,
          giftItemId: gift.id,
          redemptionType: RedemptionType.GIFT,
          pointsSpent,
          cashValue: null,
        },
      });

      // Mirrors the earn-side pattern exactly (BillsService /
      // LoyaltyTransaction): negative delta = redeemed, per the schema
      // comment on LoyaltyTransaction.pointsDelta.
      await tx.loyaltyTransaction.create({
        data: {
          customerId: dto.customerId,
          billId: null,
          pointsDelta: -pointsSpent,
          reason: 'REDEEMED_GIFT',
        },
      });

      return redemption;
    });
  }

  private async redeemCash(
    dto: CreateRedemptionDto,
    config: LoyaltyConfig,
    balance: number,
  ) {
    if (!dto.pointsToRedeem) {
      throw new BadRequestException(
        'pointsToRedeem is required for a CASH redemption',
      );
    }
    if (config.cashRedemptionRatio === null) {
      throw new ConflictException(
        'Cash redemption ratio is not configured — the Owner must set cashRedemptionRatio on the loyalty config (PUT /loyalty-config)',
      );
    }

    const pointsSpent = dto.pointsToRedeem;
    if (balance < pointsSpent) {
      throw new BadRequestException(
        `Insufficient points: customer has ${balance}, requested to redeem ${pointsSpent}`,
      );
    }
    const cashValue = pointsSpent * config.cashRedemptionRatio;

    return this.prisma.$transaction(async (tx) => {
      // Re-check balance atomically, same reasoning as redeemGift().
      const reAgg = await tx.loyaltyTransaction.aggregate({
        where: { customerId: dto.customerId },
        _sum: { pointsDelta: true },
      });
      const currentBalance = reAgg._sum.pointsDelta ?? 0;
      if (currentBalance < pointsSpent) {
        throw new ConflictException(
          'Insufficient points — balance changed since this redemption was requested',
        );
      }

      const redemption = await tx.redemptionTransaction.create({
        data: {
          customerId: dto.customerId,
          giftItemId: null,
          redemptionType: RedemptionType.CASH,
          pointsSpent,
          cashValue,
        },
      });

      await tx.loyaltyTransaction.create({
        data: {
          customerId: dto.customerId,
          billId: null,
          pointsDelta: -pointsSpent,
          reason: 'REDEEMED_CASH',
        },
      });

      return redemption;
    });
  }
}
