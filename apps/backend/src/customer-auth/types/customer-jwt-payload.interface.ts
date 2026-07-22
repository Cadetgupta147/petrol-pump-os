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
// customerId here is a Customer (per-pump MEMBERSHIP) row id, not a
// CustomerAccount (login identity) id — see prisma/schema.prisma's
// Customer/CustomerAccount comments (Phase 0.2, docs/multi-tenancy-plan.md).
// Every "which customer" FK across the schema already points at this same
// id, so nothing downstream needed to change when the split landed.
export interface CustomerJwtPayload {
  customerId: string;
  // Phase 1 (docs/multi-tenancy-plan.md) — which pump this membership
  // belongs to. Not yet enforced anywhere (Phase 2's tenant-scoping
  // extension does that); carried on the token from here on so it's
  // available once that lands.
  pumpId: string;
  phone: string;
  scope: 'customer';
  // Session "kill switch" claim — see prisma/schema.prisma's
  // CustomerAccount.tokenVersion comment and CustomerJwtStrategy.validate(),
  // which re-checks this against the live DB value on every request.
  // Bumping CustomerAccount.tokenVersion invalidates every token minted with
  // an older value at once.
  tokenVersion: number;
  // Standard JWT claim populated by @nestjs/jwt (sub mirrors customerId).
  sub: string;
  iat?: number;
  exp?: number;
}

// What req.user is set to after CustomerJwtStrategy.validate() runs.
export interface AuthenticatedCustomer {
  customerId: string;
  pumpId: string;
  phone: string;
}
