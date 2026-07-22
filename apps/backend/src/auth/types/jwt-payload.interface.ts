import { Role } from '@prisma/client';

// JWT payload shape — kept minimal on purpose so guards (JwtAuthGuard,
// RolesGuard) can authorize a request by reading `role` straight off the
// validated token, without a DB round-trip per request (per task spec).
//
// staffId here is a Staff (per-pump MEMBERSHIP) row id, not a StaffAccount
// (login identity) id — see prisma/schema.prisma's Staff/StaffAccount
// comments (Phase 0.2, docs/multi-tenancy-plan.md). Every "who did this" FK
// across the schema already points at this same id, so nothing downstream
// needed to change when the split landed.
export interface JwtPayload {
  staffId: string;
  // Phase 1 (docs/multi-tenancy-plan.md) — which pump this membership
  // belongs to. Not yet enforced anywhere (Phase 2's tenant-scoping
  // extension does that); carried on the token from here on so it's
  // available once that lands.
  pumpId: string;
  role: Role;
  // Standard JWT claims populated by @nestjs/jwt (sub mirrors staffId).
  sub: string;
  iat?: number;
  exp?: number;
}

// What req.user is set to after JwtStrategy.validate() runs.
export interface AuthenticatedUser {
  staffId: string;
  pumpId: string;
  role: Role;
}
