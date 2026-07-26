import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { VehicleBlacklistService } from './vehicle-blacklist.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../common/tenant-context';

// Section 3.4B — the enforcement half of the vehicle/company credit
// blacklist. Covers: scope/field validation, the duplicate-active guard,
// vehicle-number normalization on both write and read, resolve(), and the
// two public lookup entry points (assertNotBlacklisted() throws,
// checkBlock() returns) sharing one underlying match so they can never
// drift apart.
describe('VehicleBlacklistService', () => {
  let service: VehicleBlacklistService;
  let prisma: {
    customer: { findUnique: jest.Mock };
    vehicleBlacklist: {
      findFirst: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn() },
      vehicleBlacklist: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleBlacklistService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(VehicleBlacklistService);
  });

  describe('create()', () => {
    it('rejects scope=VEHICLE with no vehicleNumber', async () => {
      await expect(
        runInTenantContext({ pumpId: 'pump-1' }, () =>
          service.create(
            { scope: 'VEHICLE', reason: 'defaulted' } as never,
            'staff-1',
          ),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects scope=COMPANY with no companyName', async () => {
      await expect(
        runInTenantContext({ pumpId: 'pump-1' }, () =>
          service.create(
            { scope: 'COMPANY', reason: 'defaulted' } as never,
            'staff-1',
          ),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when customerId is supplied but does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        runInTenantContext({ pumpId: 'pump-1' }, () =>
          service.create(
            {
              scope: 'VEHICLE',
              vehicleNumber: 'MH12AB1234',
              customerId: 'missing-customer',
              reason: 'defaulted',
            },
            'staff-1',
          ),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('normalizes vehicleNumber (trim/uppercase/strip spaces) before storing and duplicate-checking', async () => {
      prisma.vehicleBlacklist.findFirst.mockResolvedValue(null);
      prisma.vehicleBlacklist.create.mockResolvedValue({ id: 'entry-1' });

      await runInTenantContext({ pumpId: 'pump-1' }, () =>
        service.create(
          { scope: 'VEHICLE', vehicleNumber: '  mh 12 ab 1234  ', reason: 'defaulted' },
          'staff-1',
        ),
      );

      expect(prisma.vehicleBlacklist.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ vehicleNumber: 'MH12AB1234' }) as unknown,
        }),
      );
      expect(prisma.vehicleBlacklist.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pumpId: 'pump-1',
            vehicleNumber: 'MH12AB1234',
            blacklistedById: 'staff-1',
          }) as unknown,
        }),
      );
    });

    it('refuses a second ACTIVE entry for the same vehicle (ConflictException)', async () => {
      prisma.vehicleBlacklist.findFirst.mockResolvedValue({ id: 'existing-entry' });

      await expect(
        runInTenantContext({ pumpId: 'pump-1' }, () =>
          service.create(
            { scope: 'VEHICLE', vehicleNumber: 'MH12AB1234', reason: 'defaulted again' },
            'staff-1',
          ),
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.vehicleBlacklist.create).not.toHaveBeenCalled();
    });
  });

  describe('resolve()', () => {
    it('marks an ACTIVE entry RESOLVED with resolvedById/resolvedAt stamped from the caller', async () => {
      prisma.vehicleBlacklist.findUnique.mockResolvedValue({
        id: 'entry-1',
        status: 'ACTIVE',
      });
      prisma.vehicleBlacklist.update.mockResolvedValue({
        id: 'entry-1',
        status: 'RESOLVED',
      });

      await service.resolve('entry-1', { resolutionNote: 'paid up' }, 'owner-1');

      expect(prisma.vehicleBlacklist.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'entry-1' },
          data: expect.objectContaining({
            status: 'RESOLVED',
            resolvedById: 'owner-1',
            resolutionNote: 'paid up',
          }) as unknown,
        }),
      );
    });

    it('refuses to resolve an already-RESOLVED entry (ConflictException)', async () => {
      prisma.vehicleBlacklist.findUnique.mockResolvedValue({
        id: 'entry-1',
        status: 'RESOLVED',
      });

      await expect(
        service.resolve('entry-1', {}, 'owner-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.vehicleBlacklist.update).not.toHaveBeenCalled();
    });

    it('404s for an unknown id', async () => {
      prisma.vehicleBlacklist.findUnique.mockResolvedValue(null);

      await expect(
        service.resolve('missing', {}, 'owner-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('assertNotBlacklisted() / checkBlock() — shared match logic', () => {
    const blacklistedVehicleEntry = {
      id: 'entry-1',
      scope: 'VEHICLE',
      vehicleNumber: 'MH12AB1234',
      companyName: null,
      reason: 'unpaid credit bill',
      outstandingAmount: 4500,
    };

    it('assertNotBlacklisted() throws for a blacklisted vehicle regardless of case/whitespace in the candidate', async () => {
      prisma.vehicleBlacklist.findFirst.mockResolvedValue(blacklistedVehicleEntry);

      await expect(
        service.assertNotBlacklisted({ vehicleNumbers: ['mh 12 ab 1234'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('checkBlock() returns blocked:true for the same match, non-throwing', async () => {
      prisma.vehicleBlacklist.findFirst.mockResolvedValue(blacklistedVehicleEntry);

      const result = await service.checkBlock({ vehicleNumbers: ['mh 12 ab 1234'] });
      expect(result.blocked).toBe(true);
      expect(result.entry?.id).toBe('entry-1');
    });

    it('matches a blacklisted company case-insensitively', async () => {
      prisma.vehicleBlacklist.findFirst.mockResolvedValue({
        id: 'entry-2',
        scope: 'COMPANY',
        vehicleNumber: null,
        companyName: 'Sharma Transport',
        reason: 'fleet default',
        outstandingAmount: 0,
      });

      const result = await service.checkBlock({ companyName: 'sharma transport' });
      expect(result.blocked).toBe(true);

      expect(prisma.vehicleBlacklist.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ACTIVE',
            OR: expect.arrayContaining([
              expect.objectContaining({
                scope: 'COMPANY',
                companyName: { equals: 'sharma transport', mode: 'insensitive' },
              }),
            ]) as unknown,
          }) as unknown,
        }),
      );
    });

    it('returns not-blocked (never throws) when nothing matches', async () => {
      prisma.vehicleBlacklist.findFirst.mockResolvedValue(null);

      await expect(
        service.assertNotBlacklisted({ vehicleNumbers: ['DL01AA0001'] }),
      ).resolves.toBeUndefined();

      const result = await service.checkBlock({ vehicleNumbers: ['DL01AA0001'] });
      expect(result).toEqual({ blocked: false, entry: null });
    });

    it('short-circuits to no query at all when no candidate is supplied', async () => {
      const result = await service.checkBlock({});
      expect(result).toEqual({ blocked: false, entry: null });
      expect(prisma.vehicleBlacklist.findFirst).not.toHaveBeenCalled();
    });

    it('includes the outstanding amount and resolve-endpoint pointer in the block message', async () => {
      prisma.vehicleBlacklist.findFirst.mockResolvedValue({
        id: 'entry-3',
        scope: 'VEHICLE',
        vehicleNumber: 'MH12AB1234',
        companyName: null,
        reason: 'unpaid credit bill',
        outstandingAmount: 2500,
      });

      let message = '';
      try {
        await service.assertNotBlacklisted({ vehicleNumbers: ['MH12AB1234'] });
      } catch (error) {
        message = (error as BadRequestException).message;
      }
      expect(message).toContain('2500.00');
      expect(message).toContain('/vehicle-blacklist/entry-3/resolve');
    });
  });
});
