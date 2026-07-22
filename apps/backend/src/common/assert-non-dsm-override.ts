import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';

// Section 3.3 manual-entry fallback — backdating a shift's shiftStart/
// shiftEnd (for "the DSM app was down, entering this after the fact") is a
// supervisor-only override (Owner/Accountant/Manager), never available to a
// DSM recording their own shift live. Unlike resolveAssignableActorId()
// (which has a sensible default: the caller), there's no meaningful default
// for "what timestamp did you mean" beyond now() — so this just rejects
// outright when a DSM sends the field at all, rather than silently
// substituting a value.
export function assertNonDsmOverride(user: AuthenticatedUser, fieldName: string): void {
  if (user.role === Role.DSM) {
    throw new ForbiddenException(`Only a supervisor (not DSM) can set ${fieldName}`);
  }
}
