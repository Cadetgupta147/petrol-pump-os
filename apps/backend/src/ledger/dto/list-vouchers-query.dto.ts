import { IsDateString, IsOptional, IsString } from 'class-validator';

// GET /vouchers?from=&to=&ledgerAccountId= — all independently optional.
export class ListVouchersQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  ledgerAccountId?: string;
}
