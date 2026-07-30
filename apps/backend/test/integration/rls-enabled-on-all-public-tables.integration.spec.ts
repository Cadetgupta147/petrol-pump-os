// Real-database integration test — hits the actual Supabase dev DB, NOT a
// mocked PrismaService (see owner-lockout-race.integration.spec.ts in this
// same directory for the full explanation of why these tests live outside
// src/ and run via their own `npm run test:integration` command instead of
// plain `npm test`).
//
// Regression guard for migration 20260730150329_enable_rls_deny_by_default
// (see that migration's own header comment, and docs/security-notes.md).
// That migration enabled Row Level Security on every table in schema
// `public` and revoked anon/authenticated's SQL-level grants, closing an
// audit finding that Supabase's auto-exposed PostgREST REST API let anyone
// with the publishable anon key read/write every table (Customer, Bill,
// StaffAccount, CashCustodyLog, UpiCaptureConfig, _prisma_migrations, etc.)
// directly, completely bypassing this app's NestJS JwtAuthGuard/RolesGuard.
//
// Nothing in Prisma's schema or migration tooling stops a FUTURE migration
// from creating a new table without RLS enabled (e.g. a plain `CREATE TABLE`
// added to some other migration.sql, or a table added via `prisma migrate
// dev` whose generated SQL doesn't happen to include an ENABLE ROW LEVEL
// SECURITY statement — nothing in the Prisma schema language itself
// expresses RLS, so there's no schema-level guardrail against this
// regressing). This test is the guardrail: it queries the Postgres catalog
// directly and fails loudly, by table name, if it ever finds one.
//
// IMPORTANT — see this repo's .github/workflows/ci.yml: its `Test` step is
// currently commented out, and there is no `test:integration` step in CI at
// all. This test only runs when a human invokes `npm run test:integration`
// locally — it will NOT catch a regression automatically in CI until that
// gap is closed (a separate, apparently-deliberate decision per that file's
// own "Uncomment once each app has tests/lint configured" comment — not
// something this test file can fix on its own).
import { resolve } from 'path';
import * as dotenv from 'dotenv';

// See owner-lockout-race.integration.spec.ts's comment on this same line for
// why this must run before `new PrismaService()` anywhere below, and why
// four levels up from apps/backend/test/integration reaches the repo root.
dotenv.config({ path: resolve(__dirname, '../../../../.env') });

import { PrismaService } from '../../src/prisma/prisma.service';

describe('RLS is enabled on every table in schema public (regression guard, integration)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('has zero tables with rowsecurity = false', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false ORDER BY tablename;`,
    );

    if (rows.length > 0) {
      const names = rows.map((r) => r.tablename).join(', ');
      throw new Error(
        `${rows.length} table(s) in schema public have RLS DISABLED: ${names}. ` +
          'This is a regression of migration 20260730150329_enable_rls_deny_by_default ' +
          '(see docs/security-notes.md) — every table in public must have RLS enabled ' +
          '(deny-by-default: no policies needed, since the app only ever connects as the ' +
          'table-owning, rolbypassrls=true `postgres` role). If a new table was just added, ' +
          'add `ALTER TABLE public."<name>" ENABLE ROW LEVEL SECURITY;` to its migration ' +
          '(no FORCE ROW LEVEL SECURITY — that would also block the app\'s own connection).',
      );
    }

    expect(rows).toHaveLength(0);
  }, 15_000);

  it('sanity check: found at least one table to check (guards against a config typo silently passing on zero tables)', async () => {
    const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM pg_tables WHERE schemaname = 'public';`,
    );
    expect(Number(count)).toBeGreaterThan(0);
  }, 15_000);
});
