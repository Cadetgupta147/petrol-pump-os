import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { EarningBasis, RedemptionType } from '@prisma/client';

// PUT /loyalty-config — Section 6.2 (earning side) + the Section 6.4
// redemption knobs the schema already carries.
//
// earningBasis and defaultRate are REQUIRED on every PUT: there is no
// hardcoded launch default for either (open decision, Section 17), so the
// dealer must state them explicitly — the API never invents a rate.
//
// The redemption-side fields are optional AND nullable: redemption policy at
// launch is itself still open (Section 17), so the earning side can be
// configured without guessing a redemption setup. Passing null clears a
// previously-set value.
export class UpsertLoyaltyConfigDto {
  @IsEnum(EarningBasis)
  earningBasis!: EarningBasis;

  @IsNumber()
  @Min(0)
  defaultRate!: number;

  @IsOptional()
  @IsEnum(RedemptionType)
  redemptionTypeAllowed?: RedemptionType | null;

  @IsOptional()
  @IsBoolean()
  customerCanChooseRedemption?: boolean;

  @IsOptional()
  @IsEnum(RedemptionType)
  defaultRedemptionMode?: RedemptionType | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashRedemptionRatio?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  minRedeemablePoints?: number | null;
}
