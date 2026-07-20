import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { LoyaltyService } from './loyalty.service';
import { CalculatePointsDto } from './dto/calculate-points.dto';

// Section 6.2/6.3 — server-side points calculation. POST because the inputs
// are a structured body, but it has NO side effects: nothing is written, no
// points are credited. Crediting points on bill save (Section 6.3 step 5) is
// a separate slice that will reuse LoyaltyService.calculatePoints().
//
// Auth: valid JWT required globally (app.module.ts). DSM is allowed here in
// addition to Owner/Accountant — the DSM app's New Bill screen needs the
// live points preview after a QR scan (Section 6.3), same reasoning as
// BillsController.create(). The DSM never sees or picks the rate itself —
// the server looks it up (Section 6.2).
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @HttpCode(HttpStatus.OK)
  @Post('calculate-points')
  calculatePoints(@Body() dto: CalculatePointsDto) {
    return this.loyaltyService.calculatePoints(dto);
  }

  // Section 12 — Loyalty Program Cost Report. Per that section's table this
  // report is Owner-only (not Accountant — unlike most other reports here,
  // this one is scoped narrower, matching how loyalty-rate/redemption
  // config writes are already Owner-only per Section 2 "Accountant cannot
  // change loyalty rates"). Read-only is also allowed, same "view
  // dashboards and reports only" reasoning as CashCustodyController's
  // report route. This is a read-only reporting endpoint — no
  // money/points are written here.
  @Roles(Role.OWNER, Role.READ_ONLY)
  @Get('cost-report')
  getCostReport() {
    return this.loyaltyService.getCostReport();
  }
}
