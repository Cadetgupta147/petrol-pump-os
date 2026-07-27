import { Body, Controller, Get, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { TaxRateConfigService } from './tax-rate-config.service';
import { UpsertTaxRateConfigDto } from './dto/upsert-tax-rate-config.dto';

// Section 17.22 — per-product GST rate, dealer-configurable. Read matches
// the sales-purchase-register report's role set (Owner/Accountant/
// Read-only). Write is Owner-only, same reasoning as CreditConfig/
// DensityRangeConfig: this is business/tax policy, not day-to-day entry —
// one of Accountant's carve-outs (Section 2).
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.READ_ONLY)
@Controller('tax-rate-config')
export class TaxRateConfigController {
  constructor(private readonly taxRateConfigService: TaxRateConfigService) {}

  @Get()
  findAll() {
    return this.taxRateConfigService.findAll();
  }

  @Roles(Role.OWNER)
  @Put()
  upsert(@Body() dto: UpsertTaxRateConfigDto) {
    return this.taxRateConfigService.upsert(dto);
  }
}
