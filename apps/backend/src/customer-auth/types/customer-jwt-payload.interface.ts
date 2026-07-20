// Customer-scoped JWT payload — deliberately a DIFFERENT shape than Staff's
// JwtPayload (apps/backend/src/auth/types/jwt-payload.interface.ts:
// { staffId, role, sub }). This one carries { customerId, phone, scope, sub }
// instead, and is signed with a SEPARATE secret (CUSTOMER_JWT_SECRET, see
// customer-jwt.strategy.ts) — not just a different shape. That means a
// customer token can never verify against the staff JwtStrategy (different
// secret => signature check fails outright, before either strategy's
// `validate()` even runs), and vice versa. `scope: 'customer'` is a second,
// belt-and-suspenders discriminator in case these two strategies were ever
// accidentally pointed at the same secret in a future refactor.
export interface CustomerJwtPayload {
  customerId: string;
  phone: string;
  scope: 'customer';
  // Session "kill switch" claim — see prisma/schema.prisma's
  // Customer.tokenVersion comment and CustomerJwtStrategy.validate(), which
  // re-checks this against the live DB value on every request. Bumping
  // Customer.tokenVersion invalidates every token minted with an older
  // value at once.
  tokenVersion: number;
  // Standard JWT claim populated by @nestjs/jwt (sub mirrors customerId).
  sub: string;
  iat?: number;
  exp?: number;
}

// What req.user is set to after CustomerJwtStrategy.validate() runs.
export interface AuthenticatedCustomer {
  customerId: string;
  phone: string;
}
