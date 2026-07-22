import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NozzlesService } from './nozzles.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../common/tenant-context';

// Section 3.3/4 — Nozzle master. Covers the rule-heavy behaviors this
// module owns: the carry-forward "next opening reading" calculation, the
// startingReading-is-immutable-once-history-exists guard, and the
// disable-blocked-while-an-open-shift-exists guard (CLAUDE.md's "write
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
    it('stamps pumpId from the tenant context, references itemId, and returns nextOpeningReading = startingReading (no history yet)', async () => {
      prisma.nozzle.create.mockResolvedValue({
        id: 'n1',
        pumpId: 'pump-1',
        label: 'N1',
        itemId: 'item-1',
        startingReading: 1000,
        rolloverAt: null,
        isActive: true,
        createdAt: new Date(),
      });

      const result = await inTenant(() =>
        service.create({ label: 'N1', itemId: 'item-1', startingReading: 1000 }),
      );

      expect(prisma.nozzle.create).toHaveBeenCalledWith({
        data: {
          pumpId: 'pump-1',
          label: 'N1',
          itemId: 'item-1',
          startingReading: 1000,
          rolloverAt: undefined,
        },
        include: { item: true },
      });
      expect(result.nextOpeningReading).toBe(1000);
    });
  });

  describe('findAll — includeInactive', () => {
    it('defaults to active-only (feeds real shift-open pickers)', async () => {
      await service.findAll();
      expect(prisma.nozzle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('includeInactive=true drops the isActive filter (Settings re-enable flow)', async () => {
      await service.findAll(true);
      expect(prisma.nozzle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
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

      expect(prisma.nozzle.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'n1' }, data: { startingReading: 999 } }),
      );
    });
  });

  describe('update — disable-while-open-shift guard', () => {
    it('blocks isActive:false while this nozzle has an open shift', async () => {
      prisma.nozzle.findUnique.mockResolvedValue({ id: 'n1', label: 'N1', startingReading: 500 });
      prisma.meterReading.findFirst.mockResolvedValue({ id: 'open-shift-1' });

      await expect(
        service.update('n1', { isActive: false }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.nozzle.update).not.toHaveBeenCalled();
    });

    it('allows isActive:false when no shift is currently open', async () => {
      prisma.nozzle.findUnique.mockResolvedValue({ id: 'n1', label: 'N1', startingReading: 500 });
      prisma.meterReading.findFirst.mockResolvedValue(null);
      prisma.nozzle.update.mockResolvedValue({ id: 'n1', isActive: false });

      await service.update('n1', { isActive: false });

      expect(prisma.nozzle.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'n1' }, data: { isActive: false } }),
      );
    });

    it('allows isActive:true (re-enabling) without running the open-shift guard', async () => {
      prisma.nozzle.findUnique.mockResolvedValue({ id: 'n1', label: 'N1', startingReading: 500 });
      prisma.nozzle.update.mockResolvedValue({ id: 'n1', isActive: true });

      await service.update('n1', { isActive: true });

      // The open-shift guard only runs for isActive === false — re-enabling
      // never needs to check for an open shift.
      expect(prisma.meterReading.findFirst).toHaveBeenCalledTimes(1); // just withNextOpeningReading's own lookup
      expect(prisma.nozzle.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'n1' }, data: { isActive: true } }),
      );
    });
  });
});
