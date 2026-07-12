import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { MeterReadingsService } from './meter-readings.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';

// Section 3.3 — Meter Reading Management (manual entry / fallback + web
// corrections, per-shift/per-nozzle view, and the litres-sold-vs-billed
// variance flag).
//
// NO AUTH/ROLE GUARDS YET — same gap as BillsController/CustomersController
// (CLAUDE.md: "never trust the frontend to enforce permissions" / Section 2
// role matrix). Every endpoint below is currently open to anyone who can
// reach the API.
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
