import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { CreditAlertsService } from './credit-alerts.service';
import { UpdateCreditAlertDto } from './dto/update-credit-alert.dto';

// Section 3.4A — dealer-facing view of over-limit credit bills raised under
// CreditConfig.enforcementMode = NOTIFY.
//
// NO AUTH/ROLE GUARDS YET — see CreditAlertsService header.
@Controller('credit-alerts')
export class CreditAlertsController {
  constructor(private readonly creditAlertsService: CreditAlertsService) {}

  @Get()
  findAll() {
    return this.creditAlertsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.creditAlertsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCreditAlertDto) {
    return this.creditAlertsService.update(id, dto);
  }
}
