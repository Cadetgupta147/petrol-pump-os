import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { RedemptionType } from '@prisma/client';

// POST /redemptions — Section 6.4 (redemption policy) + Section 6.6 (counter
// redemption flow).
//
// redemptionType is restricted to CASH/GIFT (never BOTH — BOTH is a
// LoyaltyConfig setting describing "which levers exist", not a value a
// single redemption can take), and it's optional: omit it when the dealer's
// config doesn't give the caller a choice (redemptionTypeAllowed = CASH or
// GIFT outright, or BOTH with customerCanChooseRedemption = false).
// RedemptionsService resolves the effective type from LoyaltyConfig in those
// cases and rejects a mismatched value if one is passed anyway (client bug,
// not silently overridden — see RedemptionsService.resolveEffectiveType).
//
// giftItemId / pointsToRedeem are validated as "required for that branch" in
// RedemptionsService, not here — which one is required depends on the
// resolved effective type, which this DTO alone can't know before the
// service loads LoyaltyConfig.
export class CreateRedemptionDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsIn([RedemptionType.CASH, RedemptionType.GIFT])
  redemptionType?: typeof RedemptionType.CASH | typeof RedemptionType.GIFT;

  @IsOptional()
  @IsString()
  giftItemId?: string;

  // How many points the customer is spending on a CASH redemption — the
  // resulting cash value is computed server-side as
  // pointsToRedeem * config.cashRedemptionRatio. Not used for GIFT
  // redemptions: pointsSpent there is fixed by the gift's own
  // pointsRequired, and any value passed here is ignored on that branch.
  @IsOptional()
  @IsInt()
  @Min(1)
  pointsToRedeem?: number;
}
