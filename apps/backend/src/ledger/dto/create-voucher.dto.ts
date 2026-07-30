import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { VoucherType } from '@prisma/client';
import { CreateVoucherLineDto } from './create-voucher-line.dto';

// Manual voucher entry (Ledger Master's whole reason for existing — Section
// 12 Day Book, "BABU JI"/"TOLL"/"JEEP 0711"-style entries the rest of
// PumpOS has no record of). Balance validation (sum(DEBIT) === sum(CREDIT))
// is NOT expressible via decorators alone — enforced in
// VouchersService.create(), same "reject, don't clamp" philosophy as
// CashCustodyLog's 3-way split (CLAUDE.md: never trust the frontend for
// this). source/sourceKey are never accepted here — VouchersService.create()
// always stamps source: MANUAL; only LedgerPostingService's internal calls
// can set a different source.
export class CreateVoucherDto {
  @IsDateString()
  date!: string;

  @IsEnum(VoucherType)
  voucherType!: VoucherType;

  @IsOptional()
  @IsString()
  narration?: string;

  @ValidateNested({ each: true })
  @Type(() => CreateVoucherLineDto)
  @ArrayMinSize(2)
  lines!: CreateVoucherLineDto[];
}
