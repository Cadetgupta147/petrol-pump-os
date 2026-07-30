# Security notes

Known, deliberately-accepted gaps and tradeoffs from security hardening work, tracked here so they
aren't forgotten once the immediate task that surfaced them is closed out. Not a replacement for
`docs/master-plan.md`'s open-items list (Section 17) — this file is specifically for security-review
findings that were consciously accepted rather than fixed, plus the condition under which they need
to be revisited.

## Must fix before horizontal scaling: in-memory ThrottlerStorage

`@nestjs/throttler`'s default `ThrottlerStorage` (used by both `AuthModule` and `CustomerAuthModule` —
see the `ThrottlerModule.forRoot(...)` registration in each) keeps attempt counts in the process's own
memory. This is fine for a single backend instance, which is the only deployment topology this repo
currently runs.

**It will silently stop working correctly the moment this backend runs as more than one instance** —
e.g. a zero-downtime rolling deploy that briefly runs two instances, or real horizontal scaling. Each
instance would track its own independent attempt count, so an attacker split across instances (by a
load balancer) gets a fresh throttle budget per instance instead of one shared budget — the per-IP+phone
login throttle (`src/auth/guards/staff-login-throttler.guard.ts`) and the OTP request throttle
(`src/customer-auth/customer-auth.controller.ts`) would both effectively multiply their limits by the
instance count without either the code or a test ever telling you.

**Fix**: swap in `@nestjs/throttler`'s Redis storage adapter (`ThrottlerStorageRedisService` from
`@nest-lab/throttler-storage-redis` or equivalent) before this backend is ever deployed as more than one
instance. The DB-backed lockout in `AuthService` (failed-attempt counter + `lockedUntil` on
`StaffAccount`) and the OTP attempt counter (`CustomerOtp.attemptCount`) are NOT affected by this — those
already live in Postgres, not in-memory, so they stay correct across instances regardless.

## Fixed: Supabase PostgREST auto-exposed every `public` table to the `anon` key

**Finding (audit, 2026-07-30)**: Supabase auto-exposes every table in schema `public` over its
PostgREST REST API using the publishable `anon` key. This project does not use Supabase Auth (no
`auth.uid()` scheme) and no frontend is meant to talk to Supabase directly — web-portal, dsm-app, and
customer-app all go through the NestJS API, authorized via `JwtAuthGuard`/`RolesGuard`
(`docs/master-plan.md` Section 2). Despite that, the audit found that **all 45 tables** in `public`
(including `Customer`, `Bill`, `BillPaymentLine`, `StaffAccount`, `CashCustodyLog`, `CustomerOtp`,
`UpiCaptureConfig`, and `_prisma_migrations`) had:

- Row Level Security **disabled** (`pg_tables.rowsecurity = false`, zero policies in `pg_policies`), and
- Full `SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE` grants to **both** the `anon` and
  `authenticated` Postgres roles — the exact roles PostgREST authenticates REST callers as.

In practice this meant anyone with the anon key (a public, client-side-embeddable "publishable" key,
not a secret) could read or write any row in any table directly over PostgREST, completely bypassing
this app's own NestJS authorization layer. Verified empirically, not assumed: an unauthenticated
`curl` against `.../rest/v1/StaffAccount` with only the anon key returned `200` with real rows before
the fix below, and `401 permission denied for table StaffAccount` (Postgres error `42501`) after.

**Fix**: migration `20260730150329_enable_rls_deny_by_default`
(`prisma/migrations/20260730150329_enable_rls_deny_by_default/migration.sql`) does two complementary
things, generated from the `pg_tables`/`pg_default_acl` catalog rather than a hardcoded table list so
it doesn't rot as tables are added:

1. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every table in `public` (looped via a `DO $$ ... FOR
   r IN SELECT tablename FROM pg_tables ... $$` block), with **zero policies created**. RLS enabled +
   no policies = deny-by-default: any role that isn't the table owner or `BYPASSRLS` gets no rows for
   any command, full stop. Deliberately **not** `FORCE ROW LEVEL SECURITY` anywhere — that would also
   apply RLS to the table owner (`postgres`, the role this backend's Prisma client connects as via both
   `DATABASE_URL` and `DIRECT_URL`), which would break the running app.
2. `REVOKE ALL` on all tables, sequences, and routines (functions/procedures) in `public` from
   `anon`/`authenticated`, plus the equivalent `ALTER DEFAULT PRIVILEGES ... REVOKE` for each object
   type so objects created in the future don't inherit the grant either. Belt-and-braces alongside (1),
   not a replacement for it.

**Why deny-by-default instead of policy-based RLS**: this project has no Postgres-level notion of "the
current user" to write a policy against — there's no Supabase Auth, no `auth.uid()`, and the single
role the backend ever connects as (`postgres`) already owns every table and has `rolbypassrls = true`
(confirmed empirically against the live DB, both via the pooled `DATABASE_URL`/PgBouncer connection and
the direct `DIRECT_URL` connection, before this migration was written or applied). There was never a
row-level identity to scope a policy to — the goal here is purely closing the PostgREST/anon-key
surface, not building a second authorization system inside the database. Zero policies + RLS on is the
correct shape for that: nothing except the owning role gets in.

**What this does NOT do — read this before assuming RLS is "the" access control layer**: this migration
protects the PostgREST REST API surface only. It has **zero bearing** on authorization bugs inside the
NestJS application itself — e.g. a service method that forgets to filter a query by `pumpId`, or an
endpoint missing a `@Roles(...)` guard. All real authorization continues to be entirely
`JwtAuthGuard`/`RolesGuard`'s job, enforced per-endpoint in application code
(`docs/master-plan.md` Section 2). If that layer has a bug, this migration will not catch it — the
`postgres` role Prisma connects as bypasses RLS by design, so every query the backend issues, correct
or buggy, runs with full access regardless of what RLS policies exist. Don't treat this as defense in
depth against application-layer bugs; it only closes the *out-of-band* PostgREST path that the app
never intended to use in the first place.

**Regression guard**: `apps/backend/test/integration/rls-enabled-on-all-public-tables.integration.spec.ts`
queries `pg_tables` directly and fails (naming the offending table(s)) if any table in `public` ever has
`rowsecurity = false` again — e.g. from a future migration that adds a table without an `ENABLE ROW
LEVEL SECURITY` statement. Runs via `npm run test:integration`, alongside the existing real-DB
integration tests. **Known gap**: `.github/workflows/ci.yml`'s `Test` step (and its `test:integration`
equivalent) is currently commented out — CI as of this writing only runs `prisma validate` and `prisma
migrate deploy`, not any test suite. This guard exists and passes locally, but will not run
automatically in CI, and therefore will not automatically block a PR that regresses this, until that CI
gap is closed (tracked as a pre-existing, separate decision — see that file's own "Uncomment once each
app has tests/lint configured" comment).

**Explicitly out of scope here**: session-variable-based tenant isolation (`SET LOCAL
app.current_pump_id`, `FORCE ROW LEVEL SECURITY`, and a dedicated non-owner, non-bypassrls application
role that per-pump policies could actually constrain) would be real defense-in-depth for multi-tenancy —
a second, independent enforcement layer for pump-scoping, not just a PostgREST-surface lockdown. That is
a materially bigger change (a new DB role, connection-string/pooling changes, and a policy per
pump-scoped table) and is tracked separately in `docs/multi-tenancy-plan.md`, not attempted in this
slice.
