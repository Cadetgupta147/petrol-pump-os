import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma, Role } from '@prisma/client';
import { StaffManagementService } from './staff-management.service';
import { PrismaService } from '../prisma/prisma.service';

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
    staff: { findMany: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      staffAccount: { create: jest.fn(), update: jest.fn() },
      staff: { create: jest.fn(), update: jest.fn() },
    };
    prisma = {
      staff: { findMany: jest.fn(), findUnique: jest.fn() },
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

      const result = await service.create({ name: 'A', phone: '+911234567890', role: Role.DSM, pin: '1234' });

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

      await service.create({
        name: 'A',
        phone: '+911234567890',
        role: Role.ACCOUNTANT,
        password: 'longenoughpassword',
      });

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
  });
});
