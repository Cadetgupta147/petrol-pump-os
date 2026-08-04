import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { SalesReportsService } from './sales-reports.service';
import { GetSalesReportQueryDto } from './dto/get-sales-report-query.dto';
import { GetDsrQueryDto } from './dto/get-dsr-query.dto';

// Section 12 — Nozzle-wise / Vehicle-wise sales reports.
//
// Auth: same Owner/Accountant scope as DashboardController and every other
// reports endpoint in this codebase (credit-aging, sales-purchase-register,
// gift-catalog's redemption-report, loyalty's cost-report) — Section 2's
// "view dashboards and reports only" line covers Read-only too, but no
// Read-only role wiring exists anywhere yet, same gap as those other reports.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('reports')
export class SalesReportsController {
  constructor(private readonly salesReportsService: SalesReportsService) {}

  @Get('nozzle-wise-sales')
  getNozzleWiseSales(@Query() query: GetSalesReportQueryDto) {
    return this.salesReportsService.getNozzleWiseSales(query.from, query.to);
  }

  @Get('vehicle-wise-sales')
  getVehicleWiseSales(@Query() query: GetSalesReportQueryDto) {
    return this.salesReportsService.getVehicleWiseSales(query.from, query.to);
  }

  @Get('dsr')
  getDailySalesReport(@Query() query: GetDsrQueryDto) {
    return this.salesReportsService.getDailySalesReport(query.date);
  }
}
