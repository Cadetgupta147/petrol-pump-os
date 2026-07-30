import { IsEnum, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { DrCr, LedgerGroup } from '@prisma/client';

// Ledger Master — a dealer-created account head (Section 12 Day Book). Every
// field here is dealer input; isSystemManaged/systemKey/linkedCustomerId/
// linkedStaffId are never client-supplied (LedgerAccountsService.create()
// always creates isSystemManaged: false) — those are only ever set by
// LedgerPostingService's own get-or-create helpers.
export class CreateLedgerAccountDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(LedgerGroup)
  group!: LedgerGroup;

  @IsOptional()
  @IsNumber()
  openingBalance?: number;

  @IsOptional()
  @IsEnum(DrCr)
  openingBalanceType?: DrCr;
}
