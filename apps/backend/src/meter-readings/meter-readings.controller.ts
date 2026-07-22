import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { MeterReadingsService } from './meter-readings.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CorrectMeterReadingDto } from './dto/correct-meter-reading.dto';

// Section 3.3 — Meter Reading Management (manual entry / fallback + web
// corrections, per-shift/per-nozzle view, and the litres-sold-vs-billed
// variance flag).
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts) and is explicitly restricted to Owner/Accountant via
// @Roles(Role.OWNER, Role.ACCOUNTANT) below — per Section 2, both have full
// access to meter reading management.
// openShift() and closeShift() additionally allow Role.DSM — per Section 2,
// DSM/Cashier opens and closes their own shift from the DSM app.
// correctMeterReading() does NOT get a DSM override — corrections are an
// Owner/Accountant-only action, matching the class-level default below.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('meter-readings')
export class MeterReadingsController {
  constructor(private readonly meterReadingsService: MeterReadingsService) {}

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Post()
  openShift(@Body() dto: OpenShiftDto, @CurrentUser() user: AuthenticatedUser) {
    return this.meterReadingsService.openShift(dto, user);
  }

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Patch(':id/close')
  closeShift(
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meterReadingsService.closeShift(id, dto, user);
  }

  @Patch(':id/correct')
  correctMeterReading(
    @Param('id') id: string,
    @Body() dto: CorrectMeterReadingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meterReadingsService.correctMeterReading(id, dto, user.staffId);
  }

  @Get()
  findAll() {
    return this.meterReadingsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.meterReadingsService.findOne(id);
  }

  @Get(':id/variance')
  checkVariance(@Param('id') id: string) {
    return this.meterReadingsService.checkVariance(id);
  }
}
