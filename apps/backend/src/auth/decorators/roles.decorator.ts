import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

// ---------------------------------------------------------------------------
// Section 2 (User Roles & Access Matrix) — simplified for this slice.
//
// Only OWNER and ACCOUNTANT are live today. Per Section 2's matrix, Accountant
// has full access to everything currently built (customers, bills, meter
// readings, dashboard/reports, credit-config, credit-alerts) — its only
// restrictions are "cannot change loyalty rates, cannot edit staff PINs,
// cannot change business settings", and none of those three things have
// endpoints yet. So no @Roles() decorator is Accountant-restricted anywhere
// in the current codebase.
//
// IMPORTANT — when loyalty-config, staff-PIN-editing, or business-settings
// endpoints get built, they MUST be decorated `@Roles(Role.OWNER)` so
// Accountant stays locked out of them per the spec. Don't forget this when
// those controllers get scaffolded.
//
// This is intentionally a simple decorator + guard reading `role` off the
// validated JWT — NOT the "permission set stored in a config table" version
// Section 2 describes for the long run. That's out of scope while only two
// roles are active; revisit once Manager/DSM/Read-only need real endpoints.
// ---------------------------------------------------------------------------
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
