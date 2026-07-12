import { Role } from '@prisma/client';

// JWT payload shape — kept minimal on purpose so guards (JwtAuthGuard,
// RolesGuard) can authorize a request by reading `role` straight off the
// validated token, without a DB round-trip per request (per task spec).
export interface JwtPayload {
  staffId: string;
  role: Role;
  // Standard JWT claims populated by @nestjs/jwt (sub mirrors staffId).
  sub: string;
  iat?: number;
  exp?: number;
}

// What req.user is set to after JwtStrategy.validate() runs.
export interface AuthenticatedUser {
  staffId: string;
  role: Role;
}
