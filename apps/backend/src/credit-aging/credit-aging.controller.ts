import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreditAgingService } from './credit-aging.service';

// Section 12 — Credit Aging Report.
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts). Per Section 12's table this report is for Owner/
// Accountant; Read-only is also allowed, same pattern as
// CashCustodyController's report route ("view dashboards and reports only"
// per Section 2's Read-only row) — this is a read-only reporting endpoint,
// nothing here writes money/points/cash-custody data.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.READ_ONLY)
@Controller('credit-aging')
export class CreditAgingController {
  constructor(private readonly creditAgingService: CreditAgingService) {}

  @Get('report')
  getReport() {
    return this.creditAgingService.getReport();
  }
}
