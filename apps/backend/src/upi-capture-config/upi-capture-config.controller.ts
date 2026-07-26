import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { UpiCaptureConfigService } from './upi-capture-config.service';
import { UpdateUpiCaptureConfigDto } from './dto/update-upi-capture-config.dto';

// Section 8A.3 — dealer-configurable UPI auto-capture.
//
// GET is intentionally broader than the credit-config/loyalty-config
// pattern: the DSM app screen (shift-end walk-in totals) needs to know
// autoCaptureEnabled to decide whether UPI is an editable field or a
// read-only "auto-captured" one — see ShiftSalesSummaryScreen.tsx. That's
// day-to-day data entry, not business-settings policy, so DSM gets read
// access same as Owner/Accountant/Manager. The response never carries raw
// secrets regardless of role (see UpiCaptureConfigService.toSafeView()).
//
// PATCH stays Owner-only (narrower @Roles override wins — see
// RolesGuard's getAllAndOverride): entering merchant credentials and
// flipping auto-capture on/off is a business-settings decision, same
// category as credit enforcement mode and loyalty rates (Section 2).
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.DSM)
@Controller('upi-capture-config')
export class UpiCaptureConfigController {
  constructor(private readonly upiCaptureConfigService: UpiCaptureConfigService) {}

  @Get()
  get() {
    return this.upiCaptureConfigService.getOrCreate();
  }

  @Roles(Role.OWNER)
  @Patch()
  update(@Body() dto: UpdateUpiCaptureConfigDto) {
    return this.upiCaptureConfigService.update(dto);
  }
}
