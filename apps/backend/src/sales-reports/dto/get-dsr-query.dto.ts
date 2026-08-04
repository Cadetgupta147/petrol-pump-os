import { IsDateString, IsOptional } from 'class-validator';

// GET /reports/dsr?date=YYYY-MM-DD — Section 12B. A Day Book is inherently
// per-day (not a from/to range) — same single-date convention as the Day
// Book's own DayBookQueryDto. Omitted -> today, server-local calendar day.
export class GetDsrQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string;
}
