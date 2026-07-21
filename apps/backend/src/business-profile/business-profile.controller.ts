import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { BusinessProfileService } from './business-profile.service';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';

// Section 3.9 — business profile / GSTIN / pump license settings.
//
// Auth: GET is Owner/Accountant (view-only, same as the other Settings
// content Accountant can see — reports, exports). PATCH is Owner-only —
// per Section 2, Accountant explicitly "cannot change business settings",
// and business name/GSTIN/license number are exactly that.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('business-profile')
export class BusinessProfileController {
  constructor(private readonly businessProfileService: BusinessProfileService) {}

  @Get()
  get() {
    return this.businessProfileService.getOrCreate();
  }

  @Roles(Role.OWNER)
  @Patch()
  update(@Body() dto: UpdateBusinessProfileDto) {
    return this.businessProfileService.update(dto);
  }
}
