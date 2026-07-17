import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

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
