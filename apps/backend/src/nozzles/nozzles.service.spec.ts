import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NozzlesService } from './nozzles.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../common/tenant-context';

// Section 3.3/4 — Nozzle master. Covers the two rule-heavy behaviors this
// slice adds: the carry-forward "next opening reading" calculation, and the
// startingReading-is-immutable-once-history-exists guard (CLAUDE.md's "write
// tests for rule-heavy logic" applies here the same way it does to loyalty/
// cash-reconciliation/variance logic).
describe('NozzlesService', () => {
  let service: NozzlesService;

  let prisma: {
    nozzle: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    meterReading: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      nozzle: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      meterReading: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [NozzlesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(NozzlesService);
  });

  function inTenant<T>(fn: () => Promise<T>) {
    return runInTenantContext({ pumpId: 'pump-1' }, fn);
  }

  describe('create', () => {
    it('stamps pumpId from the tenant context and returns nextOpeningReading = startingReading (no history yet)', async () => {
      prisma.nozzle.create.mockResolvedValue({
        id: 'n1',
        pumpId: 'pump-1',
        label: 'N1',
        productType: 'PETROL',
        startingReading: 1000,
        isActive: true,
        createdAt: new Date(),
      });

      const result = await inTenant(() =>
        service.create({ label: 'N1', productType: 'PETROL', startingReading: 1000 }),
      );

      expect(prisma.nozzle.create).toHaveBeenCalledWith({
        data: { pumpId: 'pump-1', label: 'N1', productType: 'PETROL', startingReading: 1000 },
      });
      expect(prisma.meterReading.findFirst).toHaveBeenCalledWith({
        where: { nozzleId: 'n1', closingReading: { not: null } },
        orderBy: { shiftEnd: 'desc' },
      });
      expect(result.nextOpeningReading).toBe(1000);
    });
  });

  describe('findOne — next opening reading (carry-forward)', () => {
    it('falls back to startingReading when the nozzle has never had a shift', async () => {
      prisma.nozzle.findUnique.mockResolvedValue({
        id: 'n1',
        startingReading: 500,
        label: 'N1',
      });
      prisma.meterReading.findFirst.mockResolvedValue(null);

      const result = await service.findOne('n1');

      expect(result.nextOpeningReading).toBe(500);
    });

    it('carries forward the most recently closed shift\'s closingReading', async () => {
      prisma.nozzle.findUnique.mockResolvedValue({
        id: 'n1',
        startingReading: 500,
        label: 'N1',
      });
      prisma.meterReading.findFirst.mockResolvedValue({ closingReading: 1234.5 });

      const result = await service.findOne('n1');

      expect(result.nextOpeningReading).toBe(1234.5);
    });

    it('404s on an unknown nozzle id', async () => {
      prisma.nozzle.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update — startingReading immutability', () => {
    it('blocks a startingReading change once this nozzle has any shift history', async () => {
      prisma.nozzle.findUnique.mockResolvedValue({ id: 'n1', label: 'N1', startingReading: 500 });
      prisma.meterReading.findFirst.mockResolvedValue({ id: 'mr-1' }); // has history

      await expect(
        service.update('n1', { startingReading: 999 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.nozzle.update).not.toHaveBeenCalled();
    });

    it('allows a startingReading change when this nozzle has no shift history yet', async () => {
      prisma.nozzle.findUnique.mockResolvedValue({ id: 'n1', label: 'N1', startingReading: 500 });
      prisma.meterReading.findFirst.mockResolvedValue(null); // no history
      prisma.nozzle.update.mockResolvedValue({ id: 'n1', label: 'N1', startingReading: 999 });

      await service.update('n1', { startingReading: 999 });

      expect(prisma.nozzle.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { startingReading: 999 },
      });
    });

    it('allows label/isActive changes without running the startingReading-history guard', async () => {
      prisma.nozzle.findUnique.mockResolvedValue({ id: 'n1', label: 'N1', startingReading: 500 });
      prisma.nozzle.update.mockResolvedValue({ id: 'n1', label: 'N1-renamed', startingReading: 500 });

      await service.update('n1', { label: 'N1-renamed' });

      // findFirst is still called once here — not by the immutability guard
      // (dto.startingReading is undefined, so that check is skipped
      // entirely), but by withNextOpeningReading() computing the response's
      // nextOpeningReading field, which every update() call returns.
      expect(prisma.meterReading.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.meterReading.findFirst).toHaveBeenCalledWith({
        where: { nozzleId: 'n1', closingReading: { not: null } },
        orderBy: { shiftEnd: 'desc' },
      });
      expect(prisma.nozzle.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { label: 'N1-renamed' },
      });
    });
  });
});
