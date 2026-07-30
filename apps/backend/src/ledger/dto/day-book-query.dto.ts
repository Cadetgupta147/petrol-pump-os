import { IsDateString, IsOptional } from 'class-validator';

// GET /vouchers/day-book?date=YYYY-MM-DD — a single calendar day (a day
// book is inherently per-day, not a from/to range). Omitted -> today,
// server-local calendar day, same convention used across this codebase's
// other single-day report endpoints (e.g. the dashboard sales-summary).
export class DayBookQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string;
}
