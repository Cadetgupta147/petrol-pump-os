import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma, Role } from '@prisma/client';
import { StaffManagementService } from './staff-management.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../common/tenant-context';

// Section 3.7 — Staff Management create/update. Covers the role-vs-credential
// cross rule (DSM: pin only, everyone else: password only, and the WRONG
// credential for a role is rejected, not silently ignored), the safe select
// projection (never pinHash/passwordHash), and the unique-phone conflict.
//
// Phase 0.2 (docs/multi-tenancy-plan.md): create()/update() now run inside
// $transaction(async (tx) => {...}) to create/update a StaffAccount
// (credential) alongside the Staff (membership) row — the mocked `tx` below
// exposes the same staffAccount/staff surface as the real transaction
// client, and $transaction just invokes the callback with it directly.
describe('StaffManagementService', () => {
  let service: StaffManagementService;
  let tx: {
    staffAccount: { create: jest.Mock; update: jest.Mock };
    staff: { create: jest.Mock; update: jest.Mock };
  };
  let prisma: {
    staff: { findMany: jest.Mock; findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
    // Top-level staffAccount.update — used ONLY by clearLockout(), which
    // (unlike create()/update()) doesn't need transactional atomicity with
    // any other write, so it goes straight through `this.prisma` rather than
    // a `tx` handed to it inside `$transaction(...)`.
    staffAccount: { update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      staffAccount: { create: jest.fn(), update: jest.fn() },
      staff: { create: jest.fn(), update: jest.fn() },
    };
    prisma = {
      staff: { findMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      staffAccount: { update: jest.fn() },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StaffManagementService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<StaffManagementService>(StaffManagementService);
  });

  describe('findAll', () => {
    it('selects only the safe projection (joined account phone), never pin/password hashes', async () => {
      prisma.staff.findMany.mockResolvedValue([]);
      await service.findAll();
      expect(prisma.staff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            name: true,
            role: true,
            active: true,
            createdAt: true,
            updatedAt: true,
            monthlySalary: true,
            account: { select: { phone: true } },
          },
        }),
      );
    });

    it('flattens account.phone onto the returned row', async () => {
      prisma.staff.findMany.mockResolvedValue([
        { id: 's1', name: 'A', role: Role.OWNER, active: true, createdAt: 'x', updatedAt: 'y', account: { phone: '+911234567890' } },
      ]);
      const result = await service.findAll();
      expect(result).toEqual([
        { id: 's1', name: 'A', role: Role.OWNER, active: true, createdAt: 'x', updatedAt: 'y', phone: '+911234567890' },
      ]);
    });
  });

  describe('create', () => {
    it('rejects a DSM with no pin', async () => {
      await expect(
        service.create({ name: 'A', phone: '+911234567890', role: Role.DSM }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a DSM given a password instead of a pin', async () => {
      await expect(
        service.create({
          name: 'A',
          phone: '+911234567890',
          role: Role.DSM,
          password: 'longenoughpassword',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a non-DSM role with no password', async () => {
      await expect(
        service.create({ name: 'A', phone: '+911234567890', role: Role.ACCOUNTANT }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-DSM role given a pin instead of a password', async () => {
      await expect(
        service.create({ name: 'A', phone: '+911234567890', role: Role.ACCOUNTANT, pin: '1234' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a StaffAccount with a hashed pin and null passwordHash, then a linked Staff membership', async () => {
      tx.staffAccount.create.mockImplementation(
        (args: { data: { pinHash: string | null; passwordHash: string | null } }) =>
          Promise.resolve({ id: 'account-1', ...args.data }),
      );
      tx.staff.create.mockImplementation(
        (args: { data: { accountId: string; pumpId: string; name: string; role: Role } }) =>
          Promise.resolve({
            id: 's1',
            accountId: args.data.accountId,
            pumpId: args.data.pumpId,
            name: args.data.name,
            role: args.data.role,
            active: true,
            createdAt: 'x',
            updatedAt: 'y',
            account: { phone: '+911234567890' },
          }),
      );

      const result = await runInTenantContext({ pumpId: 'pump-1' }, () =>
        service.create({ name: 'A', phone: '+911234567890', role: Role.DSM, pin: '1234' }),
      );

      const accountCall = tx.staffAccount.create.mock.calls[0][0] as {
        data: { pinHash: string; passwordHash: null; phone: string; name: string };
      };
      expect(accountCall.data.passwordHash).toBeNull();
      expect(accountCall.data.phone).toBe('+911234567890');
      await expect(bcrypt.compare('1234', accountCall.data.pinHash)).resolves.toBe(true);

      const membershipCall = tx.staff.create.mock.calls[0][0] as {
        data: { accountId: string; role: Role };
      };
      expect(membershipCall.data.accountId).toBe('account-1');
      expect(membershipCall.data.role).toBe(Role.DSM);
      expect(result.phone).toBe('+911234567890');
    });

    it('creates a non-DSM staff with a hashed password and null pinHash', async () => {
      tx.staffAccount.create.mockImplementation(
        (args: { data: { pinHash: string | null; passwordHash: string | null } }) =>
          Promise.resolve({ id: 'account-2', ...args.data }),
      );
      tx.staff.create.mockImplementation(() =>
        Promise.resolve({
          id: 's2',
          name: 'A',
          role: Role.ACCOUNTANT,
          active: true,
          createdAt: 'x',
          updatedAt: 'y',
          account: { phone: '+911234567890' },
        }),
      );

      await runInTenantContext({ pumpId: 'pump-1' }, () =>
        service.create({
          name: 'A',
          phone: '+911234567890',
          role: Role.ACCOUNTANT,
          password: 'longenoughpassword',
        }),
      );

      const accountCall = tx.staffAccount.create.mock.calls[0][0] as {
        data: { pinHash: null; passwordHash: string };
      };
      expect(accountCall.data.pinHash).toBeNull();
      await expect(bcrypt.compare('longenoughpassword', accountCall.data.passwordHash)).resolves.toBe(true);
    });

    it('throws ConflictException on a duplicate phone', async () => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create({
          name: 'A',
          phone: '+911234567890',
          role: Role.ACCOUNTANT,
          password: 'longenoughpassword',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('throws NotFoundException for a missing staff id', async () => {
      prisma.staff.findUnique.mockResolvedValue(null);
      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for a membership with no linked account', async () => {
      prisma.staff.findUnique.mockResolvedValue({ id: 's1', role: Role.ACCOUNTANT, accountId: null, account: null });
      await expect(service.update('s1', { name: 'X' })).rejects.toThrow(BadRequestException);
    });

    it('rejects a pin reset on a non-DSM staff member', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.ACCOUNTANT,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      await expect(service.update('s1', { pin: '1234' })).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a password reset on a DSM staff member', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.DSM,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      await expect(service.update('s1', { password: 'longenoughpassword' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows deactivating without touching any credential', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.DSM,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      tx.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      tx.staff.update.mockResolvedValue({
        id: 's1',
        active: false,
        name: 'A',
        role: Role.DSM,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.update('s1', { active: false });

      expect(tx.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1' },
          data: expect.objectContaining({ active: false }),
        }),
      );
      const accountCall = tx.staffAccount.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(accountCall.data).not.toHaveProperty('pinHash');
      expect(accountCall.data).not.toHaveProperty('passwordHash');
    });

    // JWT revocation (StaffAccount.tokenVersion) — deactivating a staff
    // member must kill any outstanding session immediately, not just block
    // future logins. The bump now happens via the centralized
    // bumpStaffAccountTokenVersion(tx, accountId) helper — a SEPARATE
    // tx.staffAccount.update() call within the same transaction as the main
    // account update (see that helper's file comment for why it's a second
    // statement in one transaction rather than a field merged onto the main
    // update, or a standalone transaction of its own) — so this asserts
    // tx.staffAccount.update was called at all with the increment shape,
    // rather than pinning it to a specific call index.
    it('bumps the account tokenVersion when deactivating a staff member (dto.active: false)', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.DSM,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      tx.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      tx.staff.update.mockResolvedValue({
        id: 's1',
        active: false,
        name: 'A',
        role: Role.DSM,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.update('s1', { active: false });

      expect(tx.staffAccount.update).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: { tokenVersion: { increment: 1 } },
      });
    });

    // Reactivating must NOT bump tokenVersion — there's nothing to revoke on
    // the way back in, and doing so anyway would be surprising/undocumented
    // behavior.
    it('does not bump tokenVersion when reactivating a staff member (dto.active: true)', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.DSM,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      tx.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      tx.staff.update.mockResolvedValue({
        id: 's1',
        active: true,
        name: 'A',
        role: Role.DSM,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.update('s1', { active: true });

      const accountCall = tx.staffAccount.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(accountCall.data).not.toHaveProperty('tokenVersion');
    });

    // An update that doesn't touch `active` at all (e.g. just a name change)
    // is unrelated to session revocation and must not bump tokenVersion
    // either.
    it('does not bump tokenVersion when the update does not touch `active` at all', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.DSM,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      tx.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      tx.staff.update.mockResolvedValue({
        id: 's1',
        active: true,
        name: 'B',
        role: Role.DSM,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.update('s1', { name: 'B' });

      const accountCall = tx.staffAccount.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(accountCall.data).not.toHaveProperty('tokenVersion');
    });

    // Section 17.23 — fixed monthly salary, Owner-only (same DTO/gate as
    // every other field here).
    it('sets monthlySalary on the membership row', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.MANAGER,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      tx.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      tx.staff.update.mockResolvedValue({
        id: 's1',
        name: 'A',
        role: Role.MANAGER,
        active: true,
        monthlySalary: 25000,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.update('s1', { monthlySalary: 25000 });

      expect(tx.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1' },
          data: expect.objectContaining({ monthlySalary: 25000 }),
        }),
      );
    });

    it('hashes a matching pin reset for a DSM staff member, applied to the account not the membership', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.DSM,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      tx.staffAccount.update.mockImplementation(
        (args: { data: { pinHash?: string } }) => Promise.resolve({ id: 'account-1', ...args.data }),
      );
      tx.staff.update.mockResolvedValue({
        id: 's1',
        name: 'A',
        role: Role.DSM,
        active: true,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.update('s1', { pin: '5678' });

      const accountCall = tx.staffAccount.update.mock.calls[0][0] as { data: { pinHash: string } };
      await expect(bcrypt.compare('5678', accountCall.data.pinHash)).resolves.toBe(true);
      const membershipCall = tx.staff.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(membershipCall.data).not.toHaveProperty('pinHash');
    });

    // Section 3.7 gap resolution — a credential reset is often a response to
    // that credential being compromised (a lost phone with the pin visible,
    // a shared/guessed password); leaving an old session alive on the OLD
    // credential would defeat the point of resetting it. Both reset paths
    // now bump tokenVersion via the same bumpStaffAccountTokenVersion(tx,
    // accountId) helper used for deactivation.
    it('bumps tokenVersion on a pin reset', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.DSM,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      tx.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      tx.staff.update.mockResolvedValue({
        id: 's1',
        name: 'A',
        role: Role.DSM,
        active: true,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.update('s1', { pin: '5678' });

      expect(tx.staffAccount.update).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: { tokenVersion: { increment: 1 } },
      });
    });

    it('bumps tokenVersion on a password reset', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.ACCOUNTANT,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      tx.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      tx.staff.update.mockResolvedValue({
        id: 's1',
        name: 'A',
        role: Role.ACCOUNTANT,
        active: true,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.update('s1', { password: 'longenoughpassword' });

      expect(tx.staffAccount.update).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: { tokenVersion: { increment: 1 } },
      });
    });

    // Section 3.7 — role is now editable. A role change that does NOT cross
    // the DSM <-> non-DSM credential boundary (OWNER -> ACCOUNTANT here)
    // needs no forced credential reset, but must still bump tokenVersion —
    // RolesGuard reads `role` straight off the JWT, so an un-bumped token
    // would keep authorizing the OLD role until it naturally expires.
    it('changes a non-boundary-crossing role (OWNER -> ACCOUNTANT) without requiring a new pin/password, and bumps tokenVersion', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.OWNER,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      tx.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      tx.staff.update.mockResolvedValue({
        id: 's1',
        name: 'A',
        role: Role.ACCOUNTANT,
        active: true,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.update('s1', { role: Role.ACCOUNTANT });

      expect(tx.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1' },
          data: expect.objectContaining({ role: Role.ACCOUNTANT }),
        }),
      );
      expect(tx.staffAccount.update).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: { tokenVersion: { increment: 1 } },
      });
    });

    // Section 3.7 gap resolution — moving TO role DSM without a new pin
    // would leave the account with only a passwordHash, which DSM logins
    // never check — rejected before any write happens.
    it('rejects a role change TO DSM with no new pin', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.ACCOUNTANT,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });

      await expect(service.update('s1', { role: Role.DSM })).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts a role change TO DSM with a new pin — sets pinHash, nulls passwordHash, bumps tokenVersion', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.ACCOUNTANT,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      tx.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      tx.staff.update.mockResolvedValue({
        id: 's1',
        name: 'A',
        role: Role.DSM,
        active: true,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.update('s1', { role: Role.DSM, pin: '1234' });

      const mainAccountCall = tx.staffAccount.update.mock.calls[0][0] as {
        data: { pinHash?: string; passwordHash?: null };
      };
      await expect(bcrypt.compare('1234', mainAccountCall.data.pinHash!)).resolves.toBe(true);
      expect(mainAccountCall.data.passwordHash).toBeNull();
      expect(tx.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1' },
          data: expect.objectContaining({ role: Role.DSM }),
        }),
      );
      expect(tx.staffAccount.update).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: { tokenVersion: { increment: 1 } },
      });
    });

    // Section 3.7 gap resolution — moving AWAY FROM role DSM without a new
    // password would leave the account with only a pinHash, which no
    // non-DSM login path checks — rejected before any write happens.
    it('rejects a role change AWAY FROM DSM with no new password', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.DSM,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });

      await expect(service.update('s1', { role: Role.MANAGER })).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts a role change AWAY FROM DSM with a new password — sets passwordHash, nulls pinHash, bumps tokenVersion', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        role: Role.DSM,
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      tx.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      tx.staff.update.mockResolvedValue({
        id: 's1',
        name: 'A',
        role: Role.MANAGER,
        active: true,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.update('s1', { role: Role.MANAGER, password: 'longenoughpassword' });

      const mainAccountCall = tx.staffAccount.update.mock.calls[0][0] as {
        data: { passwordHash?: string; pinHash?: null };
      };
      await expect(bcrypt.compare('longenoughpassword', mainAccountCall.data.passwordHash!)).resolves.toBe(
        true,
      );
      expect(mainAccountCall.data.pinHash).toBeNull();
      expect(tx.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1' },
          data: expect.objectContaining({ role: Role.MANAGER }),
        }),
      );
      expect(tx.staffAccount.update).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: { tokenVersion: { increment: 1 } },
      });
    });
  });

  // Manual unlock (Section 2 amendment) — lets an Owner/Accountant clear
  // another staff member's lockout state immediately instead of waiting out
  // the escalating cooldown. Mirrors update()'s NotFoundException/
  // BadRequestException guard pattern for a missing staff row / a staff row
  // with no linked account, since clearLockout() reuses the exact same
  // findUnique + guard shape.
  describe('clearLockout', () => {
    it('throws NotFoundException for a missing staff id', async () => {
      prisma.staff.findUnique.mockResolvedValue(null);
      await expect(service.clearLockout('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for a membership with no linked account', async () => {
      prisma.staff.findUnique.mockResolvedValue({ id: 's1', accountId: null, account: null });
      await expect(service.clearLockout('s1')).rejects.toThrow(BadRequestException);
      expect(prisma.staffAccount.update).not.toHaveBeenCalled();
    });

    it('resets failedLoginAttempts, lockedUntil, and lockoutEscalationLevel to 0/null', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      prisma.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      prisma.staff.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        name: 'A',
        role: Role.DSM,
        active: true,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      const result = await service.clearLockout('s1');

      expect(prisma.staffAccount.update).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: { failedLoginAttempts: 0, lockedUntil: null, lockoutEscalationLevel: 0 },
      });
      // Consistent with the rest of this service's flattened toStaffDto
      // response shape (account.phone flattened onto `phone`).
      expect(result.phone).toBe('+911234567890');
    });

    // Clearing a lockout does not invalidate an outstanding session — there
    // is nothing to revoke, unlike deactivation/credential-reset/role-change
    // in update() above — so tokenVersion must be left untouched.
    it('does not bump tokenVersion', async () => {
      prisma.staff.findUnique.mockResolvedValue({
        id: 's1',
        accountId: 'account-1',
        account: { id: 'account-1', phone: '+911234567890' },
      });
      prisma.staffAccount.update.mockResolvedValue({ id: 'account-1' });
      prisma.staff.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        name: 'A',
        role: Role.DSM,
        active: true,
        createdAt: 'x',
        updatedAt: 'y',
        account: { phone: '+911234567890' },
      });

      await service.clearLockout('s1');

      const call = prisma.staffAccount.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data).not.toHaveProperty('tokenVersion');
    });
  });
});
