import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { StaffService } from './staff.service';

// Minimal staff directory (id + name only) — exists so screens elsewhere in
// the app can offer a real "pick a staff member" dropdown instead of
// free-text entry. NOT Section 3.7 Staff Management (no CRUD here, no PIN/
// password/phone/role in the response).
//
// Role gating: mirrors CashCustodyController's POST /cash-custody role set
// (Owner/Accountant/Manager/DSM) rather than defaulting to Owner/Accountant-
// only. CashCustodyPage's handled-by dropdown is this endpoint's first
// consumer, and that form is submittable by Manager and DSM too — if this
// route were Owner/Accountant-only, Manager/DSM would get a 403 trying to
// populate the very dropdown they need to submit their own day-end entry.
// Read-only is included too: an id+name list is harmless to expose, and
// Read-only can already view (though not submit) the cash-custody report.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.DSM, Role.READ_ONLY)
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  findAll() {
    return this.staffService.findAll();
  }
}
