import { Body, Controller, Get, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { DensityRangeConfigService } from './density-range-config.service';
import { UpsertDensityRangeConfigDto } from './dto/upsert-density-range-config.dto';

// Section 17.19 — per-product acceptable density range, dealer-configurable.
// Read matches the existing density-log read restriction (Owner/Accountant
// only — Section 12's report table: "Density/quality log — Owner (for OMC
// audits)"). Write is Owner-only, same reasoning as CreditConfigController:
// this is business/compliance policy, not day-to-day data entry, so it's
// one of Accountant's carve-outs (Section 2).
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('density-range-config')
export class DensityRangeConfigController {
  constructor(private readonly densityRangeConfigService: DensityRangeConfigService) {}

  @Get()
  findAll() {
    return this.densityRangeConfigService.findAll();
  }

  @Roles(Role.OWNER)
  @Put()
  upsert(@Body() dto: UpsertDensityRangeConfigDto) {
    return this.densityRangeConfigService.upsert(dto);
  }
}
