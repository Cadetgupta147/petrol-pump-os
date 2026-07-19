import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreditConfigService } from './credit-config.service';
import { UpdateCreditConfigDto } from './dto/update-credit-config.dto';

// Section 3.4A — dealer-configurable credit limit enforcement policy.
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts) and is explicitly restricted to Owner-only via
// @Roles(Role.OWNER) below — per Section 2, enforcementMode and
// defaultInformalCreditLimit are business-settings policy, not day-to-day
// data entry, so this IS one of Accountant's carve-outs, alongside loyalty
// rates, staff PINs, and business settings generally (Section 3.4A).
@Roles(Role.OWNER)
@Controller('credit-config')
export class CreditConfigController {
  constructor(private readonly creditConfigService: CreditConfigService) {}

  @Get()
  get() {
    return this.creditConfigService.getOrCreate();
  }

  @Patch()
  update(@Body() dto: UpdateCreditConfigDto) {
    return this.creditConfigService.update(dto);
  }
}
