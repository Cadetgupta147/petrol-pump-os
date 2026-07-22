// Manual, internal-only pump provisioning — Multi-tenancy Phase 5
// (docs/multi-tenancy-plan.md). There is no public self-service signup
// endpoint (see that plan's Context section: onboarding is manual, done by
// the operator after a new client has paid, per CLAUDE.md's "Open items"
// section). This script is the one place a new tenant gets created.
//
// Creates, atomically: Pump, a MemberIdCounter row for it (mandatory — see
// member-id.ts's allocateQrMemberId(), which throws if a pump has no
// counter row: this is the thing Phase 0.2's migration backfill created for
// the seeded default pump but nothing else creates for a NEW pump), and a
// StaffAccount + Staff(role=OWNER) membership pair so the client has a
// working login on day one. CreditConfig/BusinessProfile/LoyaltyConfig are
// deliberately NOT created here — each is a lazy upsert-on-first-access
// (see e.g. CreditConfigService.getOrCreate()), so they self-heal the first
// time the new pump's Owner touches any of those features; nothing to
// provision up front.
//
// Usage:
//   npm run provision-pump -- \
//     --pump-name "ABC Fuels" \
//     --pump-code "PUMP002" \
//     --owner-name "Jane Doe" \
//     --owner-phone "9876543210" \
//     --owner-password "SomeStrongPass123"
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
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

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

const REQUIRED_FLAGS = ['pump-name', 'pump-code', 'owner-name', 'owner-phone', 'owner-password'] as const;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const missing = REQUIRED_FLAGS.filter((flag) => !args[flag]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required flag(s): ${missing.map((f) => `--${f}`).join(', ')}\n\n` +
        'Usage: npm run provision-pump -- --pump-name "..." --pump-code "..." ' +
        '--owner-name "..." --owner-phone "..." --owner-password "..."',
    );
  }

  const pumpName = args['pump-name'];
  const pumpCode = args['pump-code'];
  const ownerName = args['owner-name'];
  const ownerPhone = args['owner-phone'].replace(/\D/g, '');
  const ownerPassword = args['owner-password'];

  if (!/^\d{10}$/.test(ownerPhone)) {
    throw new Error(`--owner-phone must be a 10-digit Indian mobile number, got "${args['owner-phone']}"`);
  }
  if (ownerPassword.length < 8) {
    throw new Error('--owner-password must be at least 8 characters');
  }

  const existingPump = await prisma.pump.findUnique({ where: { pumpCode } });
  if (existingPump) {
    throw new Error(`Pump with pumpCode "${pumpCode}" already exists (id ${existingPump.id})`);
  }
  const existingAccount = await prisma.staffAccount.findUnique({ where: { phone: ownerPhone } });
  if (existingAccount) {
    throw new Error(
      `A StaffAccount with phone "${ownerPhone}" already exists (id ${existingAccount.id}) — ` +
        'phone is the global login identifier and must be unique across every pump.',
    );
  }

  const ownerPasswordHash = await bcrypt.hash(ownerPassword, SALT_ROUNDS);

  const result = await prisma.$transaction(async (tx) => {
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

    return { pump, account, owner };
  });

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
