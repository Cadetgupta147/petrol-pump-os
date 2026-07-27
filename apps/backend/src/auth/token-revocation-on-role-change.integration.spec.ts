import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { StaffManagementService } from '../staff-management/staff-management.service';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './types/jwt-payload.interface';

// Proves the end-to-end claim behind the role-change tokenVersion bump
// (Section 3.7 gap resolution — see UpdateStaffDto's class comment and
// StaffManagementService.update()): a JWT issued BEFORE a role change must
// be rejected by JwtStrategy.validate() AFTER that role change happens, not
// silently accepted with stale role data until its natural 12h expiry. The
// unit-level "does StaffManagementService.update() call the right Prisma
// args" coverage already lives in staff-management.service.spec.ts — this
// closes the gap between that and JwtStrategy actually enforcing it.
//
// Both existing auth integration specs (auth-guards.integration.spec.ts,
// rbac-real-controllers.integration.spec.ts) follow the same "mock
// PrismaService, no real DB connection" convention — this does too, except
// the mock here is a small in-memory fake rather than a one-shot
// jest.fn().mockResolvedValue(), because this test needs
// StaffManagementService's write and JwtStrategy's later read to observe the
// SAME underlying row, with the second call seeing the first one's mutation.
describe('StaffAccount.tokenVersion — role change invalidates outstanding sessions (integration)', () => {
  beforeAll(() => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? 'test-secret-for-token-revocation-on-role-change-spec';
  });

  // Minimal in-memory stand-in for the two Staff/StaffAccount rows this test
  // needs, wired to the same subset of the Prisma surface
  // StaffManagementService.update() and JwtStrategy.validate() each use
  // (staff.findUnique + $transaction(tx => tx.staffAccount.update /
  // tx.staff.update)) — not a general-purpose Prisma mock.
  function createFakePrisma() {
    const account = {
      id: 'account-1',
      phone: '+911234567890',
      pinHash: null as string | null,
      passwordHash: 'existing-password-hash',
      tokenVersion: 0,
    };
    const staff = {
      id: 's1',
      role: Role.ACCOUNTANT as Role,
      accountId: 'account-1',
      active: true,
      name: 'A',
      monthlySalary: null as number | null,
    };

    function applyAccountData(data: Record<string, unknown>) {
      for (const [key, value] of Object.entries(data)) {
        if (
          key === 'tokenVersion' &&
          value !== null &&
          typeof value === 'object' &&
          'increment' in (value as Record<string, unknown>)
        ) {
          account.tokenVersion += (value as { increment: number }).increment;
        } else {
          (account as Record<string, unknown>)[key] = value;
        }
      }
    }

    return {
      staff: {
        // Both StaffManagementService.update() (include: { account: true })
        // and JwtStrategy.validate() (select: { account: { select: {
        // tokenVersion: true } } }) call this same method with different
        // arg shapes — the fake ignores which one was asked for and always
        // returns everything, which is all either caller reads from.
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: staff.id,
            role: staff.role,
            accountId: staff.accountId,
            account: { ...account },
          }),
        ),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => {
        const tx = {
          staffAccount: {
            update: jest.fn((args: { data: Record<string, unknown> }) => {
              applyAccountData(args.data);
              return Promise.resolve({ ...account });
            }),
          },
          staff: {
            update: jest.fn((args: { data: Record<string, unknown> }) => {
              Object.assign(staff, args.data);
              return Promise.resolve({
                id: staff.id,
                name: staff.name,
                role: staff.role,
                active: staff.active,
                monthlySalary: staff.monthlySalary,
                createdAt: 'x',
                updatedAt: 'y',
                account: { phone: account.phone },
              });
            }),
          },
        };
        return callback(tx);
      }),
    };
  }

  it('rejects a token signed before a role change, once that role change bumps tokenVersion', async () => {
    const prisma = createFakePrisma();
    const staffManagementService = new StaffManagementService(prisma as unknown as PrismaService);
    const jwtStrategy = new JwtStrategy(prisma as unknown as PrismaService);

    const originalPayload: JwtPayload = {
      staffId: 's1',
      pumpId: 'pump-1',
      role: Role.ACCOUNTANT,
      tokenVersion: 0,
      sub: 's1',
    };

    // Sanity check: the token is valid before the role change happens at all.
    await expect(jwtStrategy.validate(originalPayload)).resolves.toEqual({
      staffId: 's1',
      pumpId: 'pump-1',
      role: Role.ACCOUNTANT,
    });

    // An Owner changes this staff member's role. ACCOUNTANT -> MANAGER
    // doesn't cross the DSM <-> non-DSM credential boundary, so no forced
    // pin/password reset is needed to exercise the tokenVersion bump here.
    await staffManagementService.update('s1', { role: Role.MANAGER });

    // The ORIGINAL token — still carrying the OLD tokenVersion claim — must
    // now be rejected outright, not accepted with the stale role it was
    // signed with.
    await expect(jwtStrategy.validate(originalPayload)).rejects.toThrow(UnauthorizedException);
    await expect(jwtStrategy.validate(originalPayload)).rejects.toThrow(
      'Session has been invalidated',
    );
  });
});
