import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ShiftSalesService } from './shift-sales.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateMasterService } from '../rate-master/rate-master.service';

// Section 8A.2 — money-touching (CLAUDE.md: variance/expected-value math
// needs tests). Covers create()'s walkInLitres/expectedValue/variance
// computation + guard rails, update()'s "never let a human overwrite
// walkInUpiCollected" behavior, and incrementUpiForShift()'s math (shared
// with the webhook idempotency tests in upi-webhook.service.spec.ts).
describe('ShiftSalesService', () => {
  let service: ShiftSalesService;

  let prisma: {
    shiftSalesSummary: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    meterReading: { findUnique: jest.Mock };
    bill: { aggregate: jest.Mock };
  };
  let rateMasterService: { getCurrentRate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      shiftSalesSummary: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      meterReading: { findUnique: jest.fn() },
      bill: { aggregate: jest.fn() },
    };
    rateMasterService = { getCurrentRate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShiftSalesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RateMasterService, useValue: rateMasterService },
      ],
    }).compile();

    service = module.get(ShiftSalesService);
  });

  const closedShift = {
    id: 'shift-1',
    nozzleId: 'n1',
    staffId: 's1',
    openingReading: 1000,
    closingReading: 1500,
    shiftStart: new Date('2026-07-20T06:00:00Z'),
    shiftEnd: new Date('2026-07-20T14:00:00Z'),
    productType: 'petrol',
  };

  describe('create', () => {
    it('rejects if a summary already exists for this shift', async () => {
      prisma.shiftSalesSummary.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({ shiftId: 'shift-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s on an unknown shift', async () => {
      prisma.shiftSalesSummary.findFirst.mockResolvedValue(null);
      prisma.meterReading.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ shiftId: 'nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a still-open shift', async () => {
      prisma.shiftSalesSummary.findFirst.mockResolvedValue(null);
      prisma.meterReading.findUnique.mockResolvedValue({
        ...closedShift,
        closingReading: null,
        shiftEnd: null,
      });

      await expect(
        service.create({ shiftId: 'shift-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a shift with no productType recorded', async () => {
      prisma.shiftSalesSummary.findFirst.mockResolvedValue(null);
      prisma.meterReading.findUnique.mockResolvedValue({
        ...closedShift,
        productType: null,
      });

      await expect(
        service.create({ shiftId: 'shift-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('computes walkInLitres, expectedValue and variance from meter reading + rate + manual totals', async () => {
      prisma.shiftSalesSummary.findFirst.mockResolvedValue(null);
      prisma.meterReading.findUnique.mockResolvedValue(closedShift);
      prisma.bill.aggregate.mockResolvedValue({ _sum: { litres: 100 } }); // billed litres
      rateMasterService.getCurrentRate.mockResolvedValue({ rate: 100 });
      prisma.shiftSalesSummary.create.mockImplementation(({ data }) => data);

      const result = await service.create({
        shiftId: 'shift-1',
        walkInCashCollected: 30000,
        walkInCardCollected: 5000,
      });

      // litresSoldFromMeter = 1500 - 1000 = 500; walkInLitres = 500 - 100 = 400
      // expectedValue = 400 * 100 = 40000
      // variance = 40000 - (30000 + 0 + 5000) = 5000
      expect(result.walkInLitres).toBe(400);
      expect(result.expectedValue).toBe(40000);
      expect(result.walkInUpiCollected).toBe(0);
      expect(result.variance).toBe(5000);
      expect(result).not.toHaveProperty('warning');
    });

    it('clamps a negative computed walkInLitres to 0 and surfaces a warning instead of throwing', async () => {
      prisma.shiftSalesSummary.findFirst.mockResolvedValue(null);
      prisma.meterReading.findUnique.mockResolvedValue(closedShift);
      // billed litres (600) exceeds meter litres sold (500) -> negative raw walk-in
      prisma.bill.aggregate.mockResolvedValue({ _sum: { litres: 600 } });
      rateMasterService.getCurrentRate.mockResolvedValue({ rate: 100 });
      prisma.shiftSalesSummary.create.mockImplementation(({ data }) => data);

      const result = await service.create({ shiftId: 'shift-1' });

      expect(result.walkInLitres).toBe(0);
      expect(result.expectedValue).toBe(0);
      expect(result).toHaveProperty('warning', expect.stringContaining('negative'));
    });
  });

  describe('update', () => {
    it('recomputes variance against the DB-stored walkInUpiCollected, not a client-supplied one', async () => {
      prisma.shiftSalesSummary.findUnique.mockResolvedValue({
        id: 'summary-1',
        expectedValue: 40000,
        walkInCashCollected: 30000,
        walkInCardCollected: 5000,
        walkInUpiCollected: 2000, // e.g. already populated by a prior webhook
      });
      prisma.shiftSalesSummary.update.mockImplementation(({ data }) => data);

      const result = await service.update('summary-1', {
        walkInCashCollected: 32000,
      });

      // variance = 40000 - (32000 + 2000 + 5000) = 1000
      expect(result.variance).toBe(1000);
      expect(result.walkInCashCollected).toBe(32000);
      expect(result.walkInCardCollected).toBe(5000); // unchanged, defaulted from existing
    });
  });

  describe('incrementUpiForShift', () => {
    it('increments (not overwrites) walkInUpiCollected and recomputes variance', async () => {
      const tx = {
        shiftSalesSummary: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'summary-1',
            expectedValue: 40000,
            walkInCashCollected: 30000,
            walkInCardCollected: 5000,
            walkInUpiCollected: 1000, // already has a prior UPI payment
          }),
          update: jest.fn().mockImplementation(({ data }) => data),
        },
      } as any;

      const result = await service.incrementUpiForShift(tx, 'shift-1', 500);

      // walkInUpiCollected = 1000 + 500 = 1500
      // variance = 40000 - (30000 + 1500 + 5000) = 3500
      expect(tx.shiftSalesSummary.update).toHaveBeenCalledWith({
        where: { id: 'summary-1' },
        data: { walkInUpiCollected: 1500, variance: 3500 },
      });
      expect(result).toEqual({ walkInUpiCollected: 1500, variance: 3500 });
    });

    it('returns null (no-op) when no ShiftSalesSummary exists yet for the shift', async () => {
      const tx = {
        shiftSalesSummary: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      } as any;

      const result = await service.incrementUpiForShift(tx, 'shift-1', 500);

      expect(result).toBeNull();
      expect(tx.shiftSalesSummary.update).not.toHaveBeenCalled();
    });
  });
});
