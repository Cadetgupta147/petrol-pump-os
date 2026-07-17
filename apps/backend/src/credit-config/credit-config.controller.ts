import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreditConfigService } from './credit-config.service';
import { UpdateCreditConfigDto } from './dto/update-credit-config.dto';

// Section 3.4A — dealer-configurable credit limit enforcement policy.
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts) and is explicitly restricted to Owner/Accountant via
// @Roles(Role.OWNER, Role.ACCOUNTANT) below — per Section 2, both have full
// access to this business data; it is not one of Accountant's three narrow
// carve-outs (loyalty rates, staff PINs, business settings).
@Roles(Role.OWNER, Role.ACCOUNTANT)
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
