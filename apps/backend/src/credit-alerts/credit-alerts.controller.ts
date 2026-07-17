import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreditAlertsService } from './credit-alerts.service';
import { UpdateCreditAlertDto } from './dto/update-credit-alert.dto';

// Section 3.4A — dealer-facing view of over-limit credit bills raised under
// CreditConfig.enforcementMode = NOTIFY.
//
// Auth: global JwtAuthGuard applies, and this controller is explicitly
// restricted to Owner/Accountant via @Roles(Role.OWNER, Role.ACCOUNTANT)
// below (not one of Accountant's three carve-outs, so full access stands).
@Roles(Role.OWNER, Role.ACCOUNTANT)
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
