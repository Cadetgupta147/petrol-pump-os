import { IsEnum, IsNumber, IsPositive, IsString } from 'class-validator';
import { DrCr } from '@prisma/client';

export class CreateVoucherLineDto {
  @IsString()
  ledgerAccountId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(DrCr)
  drCr!: DrCr;
}
