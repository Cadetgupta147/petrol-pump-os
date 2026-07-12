import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

// Section 3.1 (Dashboard) / Section 12 (Reports & Analytics) — scoped-down
// slice: today's sales summary, tank stock snapshot, recent bills list only.
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts). Open to any authenticated staff member — per Section 2,
// Owner and Accountant both have full access to dashboard/reports.
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('sales-summary')
  getSalesSummary() {
    return this.dashboardService.getSalesSummary();
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
