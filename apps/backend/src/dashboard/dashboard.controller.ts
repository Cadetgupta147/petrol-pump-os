import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { GetSalesSummaryQueryDto } from './dto/get-sales-summary-query.dto';

// Section 3.1 (Dashboard) / Section 12 (Reports & Analytics) — scoped-down
// slice: today's sales summary, tank stock snapshot, recent bills list only.
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts) and is explicitly restricted to Owner/Accountant via
// @Roles(Role.OWNER, Role.ACCOUNTANT) below — per Section 2, both have full
// access to dashboard/reports.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // ?from=&to= — Section 3.1 date-range tabs (Today/Yesterday/This week/This
  // month resolved client-side into a concrete YYYY-MM-DD pair). Omitting
  // either preserves the original "today" behavior.
  @Get('sales-summary')
  getSalesSummary(@Query() query: GetSalesSummaryQueryDto) {
    return this.dashboardService.getSalesSummary(query.from, query.to);
  }

  @Get('tank-stock')
  getTankStock() {
    return this.dashboardService.getTankStock();
  }

  @Get('recent-bills')
  getRecentBills() {
    return this.dashboardService.getRecentBills();
  }
}
