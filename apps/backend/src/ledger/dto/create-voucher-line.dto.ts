import { IsEnum, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { DrCr } from '@prisma/client';

export class CreateVoucherLineDto {
  @IsString()
  ledgerAccountId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(DrCr)
  drCr!: DrCr;

  // Per-line note (Voucher Entry's Particulars grid, one Narration column
  // per row) — separate from Voucher.narration, which this line-level field
  // does not replace on the model, just on this page's entry form.
  @IsOptional()
  @IsString()
  narration?: string;
}
