import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { StaffManagementService } from './staff-management.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

// Section 3.7 — Staff Management (full CRUD, distinct from the minimal
// id+name picker at GET /staff). See staff-management.service.ts's class
// comment for the Owner-only-on-mutation judgment call.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('staff-management')
export class StaffManagementController {
  constructor(private readonly staffManagementService: StaffManagementService) {}

  @Get()
  findAll() {
    return this.staffManagementService.findAll();
  }

  @Roles(Role.OWNER)
  @Post()
  create(@Body() dto: CreateStaffDto) {
    return this.staffManagementService.create(dto);
  }

  @Roles(Role.OWNER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.staffManagementService.update(id, dto);
  }

  // Manual unlock — deliberately NOT narrowed to @Roles(Role.OWNER) the way
  // create()/update() are above: this action is available to the class-level
  // Owner/Accountant gate (unlike a credential reset or role change, clearing
  // a lockout doesn't touch a PIN/password or grant any new privilege — it
  // only lets a legitimate but currently-locked-out staff member try logging
  // in again sooner).
  //
  // This is a DELIBERATE, reviewed deviation from the Owner-only pattern on
  // create()/update() above — not an oversight to "fix" back to Owner-only.
  // The reasoning: unlocking an account RESTORES existing access rather than
  // GRANTING new privilege (it can't be used to promote anyone, reset a
  // credential, or change a role — see StaffManagementService.clearLockout(),
  // which only ever resets the three lockout fields). Restricting it to
  // Owner-only would create a real operational-downtime risk: if the one
  // person who happens to be locked out IS the Owner, or the Owner is simply
  // unreachable at the moment a legitimate staff member gets locked out
  // (e.g. after work hours, traveling), nobody could unlock anyone until the
  // escalating cooldown (see LOCKOUT_ESCALATION_DURATIONS_MS) expires on its
  // own — up to an hour, repeatedly, for a repeat lockout. Accountant access
  // avoids that single point of failure without expanding what the action
  // can actually do.
  @Post(':id/clear-lockout')
  clearLockout(@Param('id') id: string) {
    return this.staffManagementService.clearLockout(id);
  }
}
