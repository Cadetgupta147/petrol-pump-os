-- Deny-by-default Row Level Security for every table in the `public` schema.
--
-- Why: audited 2026-07-30 (see chat history / audit notes, not checked into
-- this repo) that Supabase auto-exposes every `public` table over its
-- PostgREST REST API using the publishable `anon` key, and every table
-- (Customer, Bill, BillPaymentLine, StaffAccount, CashCustodyLog,
-- CustomerOtp, UpiCaptureConfig, _prisma_migrations, etc.) had RLS disabled
-- AND held full SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE
-- grants for both `anon` and `authenticated`. That means PostgREST could
-- read/write any row in any table with just the anon key, completely
-- bypassing this app's own NestJS JwtAuthGuard/RolesGuard authorization.
--
-- This migration does two independent, complementary things (belt and
-- braces — neither replaces the other):
--   1. Enables RLS on every table with zero policies attached. RLS-enabled
--      + no policies denies ALL access (including SELECT) to any role that
--      isn't the table owner or BYPASSRLS, regardless of what SQL grants
--      that role separately holds.
--   2. Revokes the `anon`/`authenticated` SQL-level grants outright — both
--      on existing tables and, via ALTER DEFAULT PRIVILEGES, on tables
--      created in the future — so even if RLS were ever accidentally
--      disabled again on some table, those roles still have no privilege
--      to fall back on.
--
-- This backend's Prisma client connects via DATABASE_URL/DIRECT_URL as the
-- `postgres` role, which owns every table here and has rolbypassrls = true
-- (confirmed empirically against the live DB before writing this
-- migration) — so none of this affects the running NestJS API. It only
-- affects the separate, unauthenticated PostgREST surface that this app
-- does not use and never intended to expose.
--
-- Deliberately NOT using FORCE ROW LEVEL SECURITY anywhere: that would also
-- apply RLS to the table owner (`postgres`), which is exactly the role this
-- backend connects as, and would break every query the app makes.
--
-- IMPORTANT — this is NOT a substitute for application-level authorization.
-- All real access control continues to live in NestJS's JwtAuthGuard and
-- RolesGuard (docs/master-plan.md Section 2), enforced per-endpoint. This
-- migration only closes an *out-of-band* data-access path (the PostgREST
-- REST API that Supabase exposes automatically) that those guards never
-- covered in the first place, since no application code talks to Supabase's
-- REST API — the NestJS API is the only intended entry point.
--
-- Scope: this migration covers TABLES, SEQUENCES, and FUNCTIONS/PROCEDURES
-- (via the ROUTINES keyword, which covers both) in `public` — both existing
-- grants and default privileges for objects created in the future. The
-- audit that motivated this migration also flagged that `pg_default_acl`
-- granted `anon`/`authenticated` on sequences and functions, not just
-- tables; verified empirically before writing this section (not assumed):
-- `public` currently has zero user-defined functions/procedures (pg_proc /
-- information_schema.routines both empty) and zero sequences
-- (information_schema.sequences empty — this schema uses table-based
-- counters like BillNumberCounter/MemberIdCounter, not DB SERIAL/IDENTITY
-- sequences), so there is nothing here that depends on PostgREST calling a
-- `public` RPC or reading a sequence directly. Revoking now is a no-op on
-- current objects but closes the default-privilege gap for anything added
-- later. Checked on PostgreSQL 17.6 (Supabase's current version, via
-- `SELECT version()`), which supports both the FUNCTIONS and ROUTINES
-- keywords for GRANT/REVOKE and ALTER DEFAULT PRIVILEGES; ROUTINES is used
-- below since it additionally covers PROCEDURES, which FUNCTIONS alone
-- does not.

-- ---------------------------------------------------------------------
-- 1. Enable RLS (no FORCE) on every table in `public`, driven from the
--    catalog so it doesn't rot as tables are added by future migrations.
--    ENABLE ROW LEVEL SECURITY is itself idempotent in Postgres (no error
--    if already enabled), so this loop is safe to run more than once.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END
$$;

-- No policies are created here, intentionally. RLS enabled + zero policies
-- = deny-by-default: `anon`/`authenticated` (and any other non-owner,
-- non-BYPASSRLS role) get no rows for any command; `postgres` (table owner,
-- rolbypassrls = true) is unaffected and still sees/writes everything, so
-- the NestJS backend keeps working exactly as before.

-- ---------------------------------------------------------------------
-- 2. Belt-and-braces: revoke the SQL-level grants directly, for both
--    existing tables and tables created in the future.
-- ---------------------------------------------------------------------

-- Existing tables.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Existing sequences (none exist today per the pre-migration check above,
-- but harmless/no-op if that ever changes before this runs, and cheap
-- insurance either way).
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Existing functions/procedures (none exist today per the pre-migration
-- check above; ROUTINES covers both FUNCTIONS and PROCEDURES, unlike the
-- FUNCTIONS keyword alone).
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;

-- Future tables/sequences/routines created by the `postgres` role (the role
-- this backend's Prisma migrations run as) in schema `public`. ALTER
-- DEFAULT PRIVILEGES uses REVOKE, not a separate "un-grant" statement —
-- this removes the standing default-ACL entry so new objects stop
-- inheriting the anon/authenticated grant, rather than revoking a grant on
-- objects that don't exist yet (which wouldn't do anything on its own).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON ROUTINES FROM anon, authenticated;
