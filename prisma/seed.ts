// Minimal seed script — creates one OWNER and one ACCOUNTANT staff member
// (StaffAccount + Staff membership, Phase 0.2 — docs/multi-tenancy-plan.md)
// under a seeded default Pump, with a known password, so the web portal
// login flow (Section 2) has accounts to log in with. Safe to re-run:
// upserts by phone / pumpCode.
//
// Run with: npm run prisma:seed (see root package.json), or directly via
// `npx prisma db seed`.
//
// SEEDED TEST CREDENTIALS (local/dev only — never reuse in production):
//   Owner:      phone 9990000001 / password Owner@12345
//   Accountant: phone 9990000002 / password Accountant@12345
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SALT_ROUNDS = 10;
const DEFAULT_PUMP_ID = 'default_pump';

async function upsertStaffMember(params: {
  phone: string;
  name: string;
  role: Role;
  passwordHash: string;
  pumpId: string;
}) {
  const account = await prisma.staffAccount.upsert({
    where: { phone: params.phone },
    update: { passwordHash: params.passwordHash, name: params.name, active: true },
    create: { phone: params.phone, name: params.name, passwordHash: params.passwordHash },
  });

  const membership = await prisma.staff.upsert({
    where: { accountId_pumpId: { accountId: account.id, pumpId: params.pumpId } },
    update: { role: params.role, name: params.name, active: true },
    create: {
      accountId: account.id,
      pumpId: params.pumpId,
      name: params.name,
      role: params.role,
    },
  });

  return { account, membership };
}

async function main() {
  // Matches the "default_pump" row bootstrapped by the Phase 0.1 migration
  // backfill — upsert-by-pumpCode so re-running seed.ts never creates a
  // second Pump row for local/dev.
  const pump = await prisma.pump.upsert({
    where: { pumpCode: 'PUMP001' },
    update: {},
    create: { id: DEFAULT_PUMP_ID, name: 'Default Pump', pumpCode: 'PUMP001' },
  });

  const ownerPasswordHash = await bcrypt.hash('Owner@12345', SALT_ROUNDS);
  const accountantPasswordHash = await bcrypt.hash('Accountant@12345', SALT_ROUNDS);

  const owner = await upsertStaffMember({
    phone: '9990000001',
    name: 'Test Owner',
    role: Role.OWNER,
    passwordHash: ownerPasswordHash,
    pumpId: pump.id,
  });

  const accountant = await upsertStaffMember({
    phone: '9990000002',
    name: 'Test Accountant',
    role: Role.ACCOUNTANT,
    passwordHash: accountantPasswordHash,
    pumpId: pump.id,
  });

  // eslint-disable-next-line no-console
  console.log('Seeded pump + staff:', {
    pump: pump.pumpCode,
    owner: owner.account.phone,
    accountant: accountant.account.phone,
  });
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
