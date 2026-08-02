import { IsDateString, IsOptional } from 'class-validator';

// GET /vouchers/trial-balance?asOf=YYYY-MM-DD — every ledger's running
// balance as of a date (not just ledgers touched on one specific day, unlike
// the Day Book — see VouchersService.getTrialBalance()). Omitted -> today,
// server-local calendar day, same convention as DayBookQueryDto.
export class TrialBalanceQueryDto {
  @IsOptional()
  @IsDateString()
  asOf?: string;
}
