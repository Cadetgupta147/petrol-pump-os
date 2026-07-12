import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CreditConfigService } from './credit-config.service';
import { UpdateCreditConfigDto } from './dto/update-credit-config.dto';

// Section 3.4A — dealer-configurable credit limit enforcement policy.
//
// Auth: see CreditConfigService header — global JwtAuthGuard applies, no
// @Roles() restriction (not one of Accountant's three carve-outs).
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
