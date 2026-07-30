import { IsEnum, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { DrCr, LedgerGroup } from '@prisma/client';

// All fields optional/independent — a dealer can rename a ledger, re-group
// it, or correct its opening balance without resupplying the rest. Allowed
// for system-managed ledgers too (renaming "Cash" to "Till" is fine —
// auto-posting matches on systemKey, not name, see schema.prisma) EXCEPT
// group, which LedgerAccountsService.update() blocks for system-managed
// ledgers (changing what GROUP the system Sales/Cash ledger belongs to
// would misrepresent it on every report that reads LedgerGroup).
export class UpdateLedgerAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEnum(LedgerGroup)
  group?: LedgerGroup;

  @IsOptional()
  @IsNumber()
  openingBalance?: number;

  @IsOptional()
  @IsEnum(DrCr)
  openingBalanceType?: DrCr;
}
