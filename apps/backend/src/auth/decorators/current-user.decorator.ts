import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../types/jwt-payload.interface';

// Finding A1 (docs/production-readiness.md) — the server-side source of
// truth for "who performed this action" on every write that records an
// actor (Bill enteredById/editedById/deletedById, CashCustodyLog
// handledById, AttendanceLog clock-in staffId, DipReading/DensityLog
// recordedById, BillAuditLog performedById). req.user is populated by
// JwtStrategy.validate() from a verified JWT — never from a request body
// or query param, so a caller can no longer attribute an action to a
// staffId other than their own.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthenticatedUser;
  },
);
