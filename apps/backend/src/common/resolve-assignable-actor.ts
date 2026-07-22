import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';

// Finding A1 (docs/production-readiness.md) — used for the subset of
// "who does this belong to" fields that are legitimately ASSIGNABLE by a
// supervisor rather than always being the caller themselves:
// CashCustodyLog.handledById (an Accountant recording what an Owner/Manager
// took home), AttendanceLog.staffId (a Manager marking a DSM present who
// isn't the one submitting), and MeterReading.staffId (a shift assigned to
// a specific DSM operator by a supervisor). Contrast with the "pure actor"
// fields (Bill enteredById/editedById/deletedById, DipReading/DensityLog
// recordedById, BillAuditLog performedById) — those are unconditionally
// req.user.staffId, no override, since they record who performed THIS API
// call, not who a record is about.
//
// Rule: omitted -> defaults to the caller. Explicitly provided and
// different from the caller -> allowed only for non-DSM roles (Owner/
// Accountant/Manager), since DSM is the role a malicious/compromised client
// is most likely to be, and self-only for DSM closes the actual spoofing
// hole finding A1 flagged while preserving the legitimate supervisor
// recording-on-behalf-of flow the product spec relies on for these fields.
export function resolveAssignableActorId(
  user: AuthenticatedUser,
  requestedStaffId: string | undefined,
): string {
  if (!requestedStaffId || requestedStaffId === user.staffId) {
    return user.staffId;
  }
  if (user.role === Role.DSM) {
    throw new ForbiddenException(
      'DSM staff can only record this for themselves',
    );
  }
  return requestedStaffId;
}
