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
describe('StaffManagementService', () => {
  let service: StaffManagementService;
  let prisma: {
    staff: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      staff: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StaffManagementService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<StaffManagementService>(StaffManagementService);
  });

  describe('findAll', () => {
    it('selects only the safe projection, never pin/password hashes', async () => {
      prisma.staff.findMany.mockResolvedValue([]);
      await service.findAll();
      expect(prisma.staff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            name: true,
            phone: true,
            role: true,
            active: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      );
    });
  });

  describe('create', () => {
    it('rejects a DSM with no pin', async () => {
      await expect(
        service.create({ name: 'A', phone: '+911234567890', role: Role.DSM }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.staff.create).not.toHaveBeenCalled();
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
      expect(prisma.staff.create).not.toHaveBeenCalled();
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

    it('creates a DSM with a hashed pin and null passwordHash', async () => {
      prisma.staff.create.mockImplementation(
        (args: { data: { pinHash: string | null; passwordHash: string | null } }) =>
          Promise.resolve({ id: 's1', ...args.data }),
      );

      await service.create({ name: 'A', phone: '+911234567890', role: Role.DSM, pin: '1234' });

      const call = prisma.staff.create.mock.calls[0][0] as {
        data: { pinHash: string; passwordHash: null };
      };
      expect(call.data.passwordHash).toBeNull();
      await expect(bcrypt.compare('1234', call.data.pinHash)).resolves.toBe(true);
    });

    it('creates a non-DSM staff with a hashed password and null pinHash', async () => {
      prisma.staff.create.mockImplementation(
        (args: { data: { pinHash: string | null; passwordHash: string | null } }) =>
          Promise.resolve({ id: 's1', ...args.data }),
      );

      await service.create({
        name: 'A',
        phone: '+911234567890',
        role: Role.ACCOUNTANT,
        password: 'longenoughpassword',
      });

      const call = prisma.staff.create.mock.calls[0][0] as {
        data: { pinHash: null; passwordHash: string };
      };
      expect(call.data.pinHash).toBeNull();
      await expect(bcrypt.compare('longenoughpassword', call.data.passwordHash)).resolves.toBe(true);
    });

    it('throws ConflictException on a duplicate phone', async () => {
      prisma.staff.create.mockRejectedValue(
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

    it('rejects a pin reset on a non-DSM staff member', async () => {
      prisma.staff.findUnique.mockResolvedValue({ id: 's1', role: Role.ACCOUNTANT, phone: '+911234567890' });
      await expect(service.update('s1', { pin: '1234' })).rejects.toThrow(BadRequestException);
      expect(prisma.staff.update).not.toHaveBeenCalled();
    });

    it('rejects a password reset on a DSM staff member', async () => {
      prisma.staff.findUnique.mockResolvedValue({ id: 's1', role: Role.DSM, phone: '+911234567890' });
      await expect(service.update('s1', { password: 'longenoughpassword' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.staff.update).not.toHaveBeenCalled();
    });

    it('allows deactivating without touching any credential', async () => {
      prisma.staff.findUnique.mockResolvedValue({ id: 's1', role: Role.DSM, phone: '+911234567890' });
      prisma.staff.update.mockResolvedValue({ id: 's1', active: false });

      await service.update('s1', { active: false });

      expect(prisma.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1' },
          data: expect.objectContaining({ active: false }),
        }),
      );
      const call = prisma.staff.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data).not.toHaveProperty('pinHash');
      expect(call.data).not.toHaveProperty('passwordHash');
    });

    it('hashes a matching pin reset for a DSM staff member', async () => {
      prisma.staff.findUnique.mockResolvedValue({ id: 's1', role: Role.DSM, phone: '+911234567890' });
      prisma.staff.update.mockImplementation(
        (args: { data: { pinHash?: string } }) => Promise.resolve({ id: 's1', ...args.data }),
      );

      await service.update('s1', { pin: '5678' });

      const call = prisma.staff.update.mock.calls[0][0] as { data: { pinHash: string } };
      await expect(bcrypt.compare('5678', call.data.pinHash)).resolves.toBe(true);
    });
  });
});
