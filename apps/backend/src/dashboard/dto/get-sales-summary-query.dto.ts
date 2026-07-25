import { IsDateString, IsOptional } from 'class-validator';

// GET /dashboard/sales-summary?from=&to= — Section 3.1 date-range tabs.
// Both independently optional (same convention as ListBillsQueryDto) —
// omitting either preserves the original "today" behavior
// (DashboardService.getSalesSummary()'s own fallback), so the existing
// no-params caller (and the RBAC integration test hitting this route bare)
// keeps working unchanged.
export class GetSalesSummaryQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
