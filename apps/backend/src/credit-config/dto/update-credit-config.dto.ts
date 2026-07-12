import { IsEnum, IsNumber, IsOptional, IsPositive } from 'class-validator';
import { CreditEnforcementMode } from '@prisma/client';

// PATCH /credit-config — any subset of enforcementMode, defaultInformalCreditLimit.
// Section 3.4A — dealer-configurable credit limit enforcement.
export class UpdateCreditConfigDto {
  @IsOptional()
  @IsEnum(CreditEnforcementMode)
  enforcementMode?: CreditEnforcementMode;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  defaultInformalCreditLimit?: number;
}
