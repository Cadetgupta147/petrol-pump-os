import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { CashCustodyService } from './cash-custody.service';
import { CreateCashCustodyLogDto } from './dto/create-cash-custody-log.dto';

// Section 8 — Day-End Cash Reconciliation & Custody.
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts). Per Section 2's access matrix, day-end cash reconciliation
// entry is done by Owner/Accountant/Manager on the web portal, "mirrored on
// the DSM app for shift-end handover" (Section 8.1) — so DSM can also submit
// an entry via the same POST route (route-level override below, same
// pattern as MeterReadingsController). Read-only can view the report but
// never create an entry.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
@Controller('cash-custody')
export class CashCustodyController {
  constructor(private readonly cashCustodyService: CashCustodyService) {}

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.DSM)
  @Post()
  create(
    @Body() dto: CreateCashCustodyLogDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cashCustodyService.create(dto, user);
  }

  @Get()
  findAll() {
    return this.cashCustodyService.findAll();
  }

  // Section 8.1 step 3 — the per-person outstanding-balance report. Placed
  // before ':id' so 'report' isn't swallowed as a route param.
  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.READ_ONLY)
  @Get('report')
  getReport() {
    return this.cashCustodyService.getReport();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.cashCustodyService.findOne(id);
  }
}
