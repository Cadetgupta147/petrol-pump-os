import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { SalesPurchaseRegisterService } from './sales-purchase-register.service';
import { DateRangeQueryDto } from '../common/dto/date-range-query.dto';

// Section 12 — "GST-ready sales/purchase report... exportable to Tally."
// See sales-purchase-register.service.ts's class comment for the tax-rate
// modeling gap this report deliberately does NOT invent an answer for.
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts). Per Section 12's table this report is for Accountant;
// Owner is always included (Section 2: Owner "can do everything... all
// reports"), and Read-only is also allowed, same "view dashboards and
// reports only" reasoning as CashCustodyController's report route. This is
// a read-only reporting endpoint — nothing here writes money data.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.READ_ONLY)
@Controller('sales-purchase-register')
export class SalesPurchaseRegisterController {
  constructor(
    private readonly salesPurchaseRegisterService: SalesPurchaseRegisterService,
  ) {}

  @Get()
  getRegister(@Query() dto: DateRangeQueryDto) {
    return this.salesPurchaseRegisterService.getRegister(dto);
  }
}
