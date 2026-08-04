import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { VoucherType } from '@prisma/client';

// GET /vouchers/day-book?date=YYYY-MM-DD — a single calendar day (a day
// book is inherently per-day, not a from/to range). Omitted -> today,
// server-local calendar day, same convention used across this codebase's
// other single-day report endpoints (e.g. the dashboard sales-summary).
export class DayBookQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  // Section 12A — 'ledger' (default, unchanged) groups by LedgerAccount with
  // O/B and C/B per ledger. 'chronological' is the shift-wise, time-ordered
  // view over the SAME Voucher/VoucherLine data — see
  // VouchersService.buildChronologicalView().
  @IsOptional()
  @IsIn(['ledger', 'chronological'])
  view?: 'ledger' | 'chronological';

  // The three filters below only affect view=chronological — the Ledger
  // View ignores them (see VouchersService.getDayBook()'s comment for why).
  @IsOptional()
  @IsIn(['PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL', 'SALES', 'PURCHASE'])
  voucherType?: VoucherType;

  @IsOptional()
  @IsIn(['CASH', 'CARD', 'UPI', 'CREDIT', 'OTHER'])
  paymentMode?: 'CASH' | 'CARD' | 'UPI' | 'CREDIT' | 'OTHER';

  @IsOptional()
  @IsString()
  partyLedgerAccountId?: string;
}
