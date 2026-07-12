import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CreditConfigService } from './credit-config.service';
import { UpdateCreditConfigDto } from './dto/update-credit-config.dto';

// Section 3.4A — dealer-configurable credit limit enforcement policy.
//
// NO AUTH/ROLE GUARDS YET — see CreditConfigService header. This is
// money-adjacent policy config and must be Owner/Accountant-only before it
// ships past local development.
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
