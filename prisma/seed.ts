// Minimal seed script — creates one OWNER and one ACCOUNTANT Staff row with
// a known password, so the web portal login flow (Section 2) has accounts
// to log in with. Safe to re-run: upserts by phone.
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

async function main() {
  const ownerPasswordHash = await bcrypt.hash('Owner@12345', SALT_ROUNDS);
  const accountantPasswordHash = await bcrypt.hash('Accountant@12345', SALT_ROUNDS);

  const owner = await prisma.staff.upsert({
    where: { phone: '9990000001' },
    update: { passwordHash: ownerPasswordHash, role: Role.OWNER, active: true },
    create: {
      name: 'Test Owner',
      phone: '9990000001',
      role: Role.OWNER,
      passwordHash: ownerPasswordHash,
    },
  });

  const accountant = await prisma.staff.upsert({
    where: { phone: '9990000002' },
    update: { passwordHash: accountantPasswordHash, role: Role.ACCOUNTANT, active: true },
    create: {
      name: 'Test Accountant',
      phone: '9990000002',
      role: Role.ACCOUNTANT,
      passwordHash: accountantPasswordHash,
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seeded staff:', { owner: owner.phone, accountant: accountant.phone });
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
