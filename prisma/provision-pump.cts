// Manual, internal-only pump provisioning — Multi-tenancy Phase 5
// (docs/multi-tenancy-plan.md). There is no public self-service signup
// endpoint (see that plan's Context section: onboarding is manual, done by
// the operator after a new client has paid, per CLAUDE.md's "Open items"
// section). This script is the one place a new tenant gets created.
//
// Creates, atomically: Pump, a MemberIdCounter row for it (mandatory — see
// member-id.ts's allocateQrMemberId(), which throws if a pump has no
// counter row: this is the thing Phase 0.2's migration backfill created for
// the seeded default pump but nothing else creates for a NEW pump), a
// StaffAccount + Staff(role=OWNER) membership pair so the client has a
// working login on day one, and default Petrol/Diesel Items (category
// FUEL) — every petrol pump sells at least these two, and Nozzle Master
// can't be configured at all until at least one FUEL item exists (see
// NozzleSettings.tsx's fuel-only item picker). Other Items (Speed, Urea/
// AdBlue, lubricant SKUs) are dealer-added later via Item Master, same as
// today. CreditConfig/BusinessProfile/LoyaltyConfig are deliberately NOT
// created here — each is a lazy upsert-on-first-access (see e.g.
// CreditConfigService.getOrCreate()), so they self-heal the first time the
// new pump's Owner touches any of those features; nothing to provision up
// front.
//
// Usage:
//   npm run provision-pump -- \
//     --pump-name "ABC Fuels" \
//     --owner-name "Jane Doe" \
//     --owner-phone "9876543210" \
//     --owner-password "SomeStrongPass123"
//
// pumpCode is NOT a flag — it's auto-assigned (see nextPumpCode() below) as
// "PUMP" + the next zero-padded sequence number after the highest existing
// PUMP### code (PUMP001, PUMP002, PUMP003, ... -> PUMP004), so the operator
// never has to track which codes are already taken.
//
// .cts (not .ts) is deliberate: this repo has no root tsconfig.json, so
// plain `ts-node prisma/provision-pump.ts` gets misdetected as ESM
// ("Unknown file extension .ts") — Node/ts-node both give the `.cts`
// extension unconditional CommonJS treatment regardless of nearest
// package.json/tsconfig, sidestepping that without needing the fragile
// `--compiler-options {"module":"CommonJS"}` CLI flag (which breaks under
// npm's argument quoting on Windows — see prisma/seed.ts's own
// "prisma".seed script for the same flag, invoked via `npx prisma db seed`
// instead, which is not affected by that same quoting bug).
//
// Non-interactive on purpose (all-flags, no prompts) — this environment has
// no TTY for interactive input, same constraint documented in the
// multi-tenancy plan's migration notes.
import { Prisma, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

// "PUMP" + the next zero-padded (min 3-digit) sequence number after the
// highest existing PUMP### code — PUMP001/PUMP002/PUMP003 -> PUMP004. Reads
// inside the same transaction as the pump insert (see main()) to keep the
// read-then-write race window as small as this script can make it; this is
// a manual, one-operator-at-a-time admin script (see header comment), not a
// concurrent public endpoint, so that's sufficient — main() still catches a
// P2002 on pumpCode as a defensive fallback rather than assuming it away.
async function nextPumpCode(tx: Prisma.TransactionClient): Promise<string> {
  const pumps = await tx.pump.findMany({
    where: { pumpCode: { startsWith: 'PUMP' } },
    select: { pumpCode: true },
  });
  const maxSeq = pumps.reduce((max, { pumpCode }) => {
    const match = /^PUMP(\d+)$/.exec(pumpCode);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `PUMP${String(maxSeq + 1).padStart(3, '0')}`;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i++;
  }
  return args;
}

const REQUIRED_FLAGS = ['pump-name', 'owner-name', 'owner-phone', 'owner-password'] as const;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const missing = REQUIRED_FLAGS.filter((flag) => !args[flag]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required flag(s): ${missing.map((f) => `--${f}`).join(', ')}\n\n` +
        'Usage: npm run provision-pump -- --pump-name "..." ' +
        '--owner-name "..." --owner-phone "..." --owner-password "..."',
    );
  }

  const pumpName = args['pump-name'];
  const ownerName = args['owner-name'];
  const ownerPhone = args['owner-phone'].replace(/\D/g, '');
  const ownerPassword = args['owner-password'];

  if (!/^\d{10}$/.test(ownerPhone)) {
    throw new Error(`--owner-phone must be a 10-digit Indian mobile number, got "${args['owner-phone']}"`);
  }
  if (ownerPassword.length < 8) {
    throw new Error('--owner-password must be at least 8 characters');
  }

  const existingAccount = await prisma.staffAccount.findUnique({ where: { phone: ownerPhone } });
  if (existingAccount) {
    throw new Error(
      `A StaffAccount with phone "${ownerPhone}" already exists (id ${existingAccount.id}) — ` +
        'phone is the global login identifier and must be unique across every pump.',
    );
  }

  const ownerPasswordHash = await bcrypt.hash(ownerPassword, SALT_ROUNDS);

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const pumpCode = await nextPumpCode(tx);
      const pump = await tx.pump.create({
        data: { name: pumpName, pumpCode },
      });

      // Mandatory — see this file's header comment and member-id.ts's
      // allocateQrMemberId(): a pump with no MemberIdCounter row makes the
      // first QR-eligible customer signup throw.
      await tx.memberIdCounter.create({
        data: { id: `mic_${pump.id}`, pumpId: pump.id, lastSeq: 0 },
      });

      const account = await tx.staffAccount.create({
        data: { phone: ownerPhone, name: ownerName, passwordHash: ownerPasswordHash },
      });

      const owner = await tx.staff.create({
        data: {
          accountId: account.id,
          pumpId: pump.id,
          name: ownerName,
          role: Role.OWNER,
        },
      });

      // Every petrol pump sells at least Petrol and Diesel — seed both as
      // default FUEL items so Nozzle Master has something to link to on day
      // one, without the Owner needing to know to visit Item Master first.
      await tx.item.createMany({
        data: [
          { pumpId: pump.id, name: 'Petrol', category: 'FUEL', unit: 'LITRE' },
          { pumpId: pump.id, name: 'Diesel', category: 'FUEL', unit: 'LITRE' },
        ],
      });

      return { pump, account, owner };
    });
  } catch (error) {
    // Defensive fallback for the race window nextPumpCode() documents —
    // two operators running this at the exact same moment could both read
    // the same max and try to insert the same pumpCode.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('pumpCode collision while provisioning — this is a rare race; just re-run the command.');
    }
    throw error;
  }

  // eslint-disable-next-line no-console
  console.log('Provisioned new pump:', {
    pumpId: result.pump.id,
    pumpCode: result.pump.pumpCode,
    pumpName: result.pump.name,
    ownerStaffId: result.owner.id,
    ownerPhone: result.account.phone,
  });
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
