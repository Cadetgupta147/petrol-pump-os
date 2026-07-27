import { IsDateString, IsOptional } from 'class-validator';

// GET /reports/nozzle-wise-sales, /reports/vehicle-wise-sales — ?from=&to=.
// Both independently optional, same convention as
// dashboard/dto/get-sales-summary-query.dto.ts — omitting either falls back
// to today.
export class GetSalesReportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
