import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { MeterReadingsService } from './meter-readings.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';

// Section 3.3 — Meter Reading Management (manual entry / fallback + web
// corrections, per-shift/per-nozzle view, and the litres-sold-vs-billed
// variance flag).
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts) and is explicitly restricted to Owner/Accountant via
// @Roles(Role.OWNER, Role.ACCOUNTANT) below — per Section 2, both have full
// access to meter reading management.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('meter-readings')
export class MeterReadingsController {
  constructor(private readonly meterReadingsService: MeterReadingsService) {}

  @Post()
  openShift(@Body() dto: OpenShiftDto) {
    return this.meterReadingsService.openShift(dto);
  }

  @Patch(':id/close')
  closeShift(@Param('id') id: string, @Body() dto: CloseShiftDto) {
    return this.meterReadingsService.closeShift(id, dto);
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
