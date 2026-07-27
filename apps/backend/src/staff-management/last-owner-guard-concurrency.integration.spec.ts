import { resolve } from 'path';
import * as dotenv from 'dotenv';

// .env lives at the repo root (npm workspace), not inside apps/backend — see
// app.module.ts's ROOT_ENV_PATH comment for the same reasoning. That file's
// ConfigModule.forRoot({ envFilePath }) only runs when the full Nest app
// bootstraps; this spec constructs a real PrismaService directly (no Nest
// TestingModule), so nothing populates process.env.DATABASE_URL unless this
// spec loads the .env file itself, and it must do so BEFORE `new
// PrismaService()` runs anywhere below — PrismaClient resolves its
// datasource url (the `env("DATABASE_URL")` in schema.prisma) at
// construction time, not lazily on first query.
//
// __dirname here is apps/backend/src/staff-management (ts-jest runs specs
// straight out of src, unlike the compiled dist/ path app.module.ts anchors
// against) — four levels up reaches the repo root.
dotenv.config({ path: resolve(__dirname, '../../../../.env') });

import * as bcrypt from 'bcrypt';
import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StaffManagementService } from './staff-management.service';

// Deliberately NOT following this suite's usual "mock PrismaService
// everywhere" convention (see every other *.spec.ts in this directory) — a
// mocked `tx` can't exercise real Postgres row-locking/blocking behavior,
// which is exactly what's under test here. This needs two genuinely
// concurrent transactions over real DB connections, so it talks to the real
// (Supabase) dev DB, same as `npm run start:dev` does. Jest's testRegex
// (`.*\.spec\.ts$`, see apps/backend/package.json) picks this file up
// automatically as part of `npm test` — no separate test command needed.
//
// Proves the fix in StaffManagementService.update() (see that method's
// "RACE FIX" comment on the last-Owner guard): two concurrent requests
// demoting/deactivating two DIFFERENT Owners at the same pump must not both
// succeed and strand the pump with zero active Owners. A mocked-tx unit test
// (staff-management.service.spec.ts's 'last-Owner guard' describe block)
// already covers the guard's LOGIC against a single sequential call — this
// covers the concurrency behavior that logic alone can't prove safe.
describe('Last-Owner guard — closes the race under real concurrent transactions (integration)', () => {
  // One shared PrismaService/PrismaClient instance, not two separate ones.
  // Prisma's own internal connection pool (not PgBouncer's, though this
  // DATABASE_URL also routes through PgBouncer in transaction-pooling mode —
  // pgbouncer=true is already set, which is what disables prepared-statement
  // caching so that mode works with Prisma at all) hands out a distinct
  // connection per concurrent `$transaction(...)` call, exactly like the
  // real running server does with its single PrismaService instance serving
  // many concurrent requests. That's the realistic scenario this guard has
  // to survive, so a single shared instance is deliberately what's tested
  // here rather than two separate PrismaClients — see this describe block's
  // final note in the task report for confirmation this held up empirically
  // (no maxWait/timeout flakiness observed across repeated runs).
  let prisma: PrismaService;
  let service: StaffManagementService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  let pumpId: string | undefined;
  let account1Id: string | undefined;
  let account2Id: string | undefined;
  let staff1Id: string | undefined;
  let staff2Id: string | undefined;

  beforeAll(async () => {
    prisma = new PrismaService();
    // Jest's default 5s hook timeout is tuned for mocked/in-memory tests —
    // this hook makes 6 sequential round trips to the real (Supabase,
    // ap-northeast-2) dev DB over the network (connect + create pump +
    // 2 accounts + 2 staff rows), which comfortably exceeds 5s. Bumped
    // rather than batching the creates, to keep each one simple/readable
    // and to keep the sequencing (pump, then accounts, then staff rows,
    // respecting FK dependencies) obvious.
    // Prisma clients auto-connect lazily on first query, but calling this
    // explicitly surfaces a DB-unreachable error here, at setup, rather than
    // inside the first test's assertions.
    await prisma.onModuleInit();

    // Pump.pumpCode is @unique — suffixed with runId so repeated local runs
    // (and, in theory, two runs racing each other) don't collide.
    const pump = await prisma.pump.create({
      data: { name: `Last-Owner Guard Test Pump ${runId}`, pumpCode: `TESTPUMP-LOG-${runId}` },
    });
    pumpId = pump.id;

    // StaffAccount.phone is @unique — same suffixing approach, with a
    // trailing digit that differs between the two accounts so they can
    // never collide with EACH OTHER even if Date.now() somehow ties.
    // Credential shape (password, ACCOUNTANT-style) doesn't matter for this
    // test — only role/active/pumpId on the Staff row do. A low bcrypt cost
    // factor keeps setup fast; this hash is never actually compared against
    // in this test.
    const passwordHash = await bcrypt.hash('irrelevant-for-this-test', 4);
    const account1 = await prisma.staffAccount.create({
      data: { name: `Test Owner A ${runId}`, phone: `+91${runId}1`, passwordHash },
    });
    account1Id = account1.id;
    const account2 = await prisma.staffAccount.create({
      data: { name: `Test Owner B ${runId}`, phone: `+91${runId}2`, passwordHash },
    });
    account2Id = account2.id;

    const staff1 = await prisma.staff.create({
      data: { pumpId: pump.id, accountId: account1.id, name: account1.name, role: Role.OWNER, active: true },
    });
    staff1Id = staff1.id;
    const staff2 = await prisma.staff.create({
      data: { pumpId: pump.id, accountId: account2.id, name: account2.name, role: Role.OWNER, active: true },
    });
    staff2Id = staff2.id;

    service = new StaffManagementService(prisma);
  }, 30_000);

  afterAll(async () => {
    // Delete exactly the rows created above, by the exact IDs captured
    // during setup — never by re-querying via phone/name — and in FK order
    // (Staff before StaffAccount/Pump). Wrapped so a failure deleting one
    // row (e.g. beforeAll partially failed and an id was never set) doesn't
    // stop the rest of cleanup or skip $disconnect(), which would otherwise
    // leak a connection and/or orphan rows in the shared dev DB.
    try {
      if (staff1Id) {
        await prisma.staff.delete({ where: { id: staff1Id } }).catch(() => undefined);
      }
      if (staff2Id) {
        await prisma.staff.delete({ where: { id: staff2Id } }).catch(() => undefined);
      }
      if (account1Id) {
        await prisma.staffAccount.delete({ where: { id: account1Id } }).catch(() => undefined);
      }
      if (account2Id) {
        await prisma.staffAccount.delete({ where: { id: account2Id } }).catch(() => undefined);
      }
      if (pumpId) {
        await prisma.pump.delete({ where: { id: pumpId } }).catch(() => undefined);
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);

  it('allows exactly one of two concurrent deactivations of different Owners at the same pump to succeed, never both', async () => {
    const results = await Promise.allSettled([
      service.update(staff1Id!, { active: false }),
      service.update(staff2Id!, { active: false }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one of the two concurrent requests must win — if the race were
    // still open, BOTH would independently see "1 other active Owner" (each
    // other) before either commits, and both would be fulfilled.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(BadRequestException);
    expect((rejection.reason as BadRequestException).message).toBe(
      'Cannot deactivate or change role: at least one active Owner must remain for this pump',
    );

    // Extra correctness check beyond trusting the promise results — re-query
    // both Staff rows fresh from the DB and confirm the invariant actually
    // held THERE: exactly one active Owner remains, not zero (and not two
    // still-active rows if the "rejected" one somehow partially wrote
    // anything, which it shouldn't given the guard throws before any write).
    const [fresh1, fresh2] = await Promise.all([
      prisma.staff.findUniqueOrThrow({ where: { id: staff1Id! } }),
      prisma.staff.findUniqueOrThrow({ where: { id: staff2Id! } }),
    ]);
    const activeCount = [fresh1, fresh2].filter((s) => s.active).length;
    expect(activeCount).toBe(1);
  }, 30_000);
});
