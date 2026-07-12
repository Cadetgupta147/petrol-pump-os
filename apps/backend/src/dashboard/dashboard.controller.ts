import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

// Section 3.1 (Dashboard) / Section 12 (Reports & Analytics) — scoped-down
// slice: today's sales summary, tank stock snapshot, recent bills list only.
//
// NO AUTH/ROLE GUARDS YET — same gap as BillsController/CustomersController/
// MeterReadingsController (CLAUDE.md: "never trust the frontend to enforce
// permissions" / Section 2 role matrix). Every endpoint below is currently
// open to anyone who can reach the API.
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
