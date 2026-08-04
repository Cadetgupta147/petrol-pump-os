import { Test, TestingModule } from '@nestjs/testing';
import { SalesReportsService } from './sales-reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateMasterService } from '../rate-master/rate-master.service';

// Section 12B — Daily Sales Report. First test file for this module (the
// pre-existing nozzle-wise/vehicle-wise methods had none) — covers the one
// genuinely rule-heavy, money-and-stock-touching method here (CLAUDE.md).
describe('SalesReportsService', () => {
  let service: SalesReportsService;

  let prisma: {
    meterReading: { findMany: jest.Mock };
    bill: { findMany: jest.Mock };
    shiftSalesSummary: { findMany: jest.Mock };
    purchaseEntry: { findMany: jest.Mock };
    dipReading: { findMany: jest.Mock };
    tank: { findMany: jest.Mock };
    shiftDefinition: { findMany: jest.Mock };
  };
  let rateMaster: { getCurrentRate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      meterReading: { findMany: jest.fn().mockResolvedValue([]) },
      bill: { findMany: jest.fn().mockResolvedValue([]) },
      shiftSalesSummary: { findMany: jest.fn().mockResolvedValue([]) },
      purchaseEntry: { findMany: jest.fn().mockResolvedValue([]) },
      dipReading: { findMany: jest.fn().mockResolvedValue([]) },
      tank: { findMany: jest.fn().mockResolvedValue([]) },
      shiftDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    };
    rateMaster = { getCurrentRate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RateMasterService, useValue: rateMaster },
      ],
    }).compile();

    service = module.get(SalesReportsService);
  });

  function nozzle(overrides: Partial<{ id: string; tankId: string | null; rolloverAt: number | null; itemName: string }> = {}) {
    return {
      id: overrides.id ?? 'nozzle-1',
      tankId: overrides.tankId ?? null,
      rolloverAt: overrides.rolloverAt ?? null,
      item: { name: overrides.itemName ?? 'Diesel' },
    };
  }

  function reading(overrides: {
    id: string;
    openingReading: number;
    closingReading: number;
    shiftStart: Date;
    shiftEnd: Date;
    meterRolledOver?: boolean;
    nozzle?: ReturnType<typeof nozzle>;
  }) {
    return {
      id: overrides.id,
      openingReading: overrides.openingReading,
      closingReading: overrides.closingReading,
      meterRolledOver: overrides.meterRolledOver ?? false,
      shiftStart: overrides.shiftStart,
      shiftEnd: overrides.shiftEnd,
      nozzle: overrides.nozzle ?? nozzle(),
    };
  }

  describe('getDailySalesReport — empty day', () => {
    it('returns an empty report when nothing was posted that day', async () => {
      const result = await service.getDailySalesReport('2026-07-20');

      expect(result).toEqual({
        date: '2026-07-20',
        fuels: [],
        stockMovement: [],
        collections: { cash: 0, card: 0, upi: 0, credit: 0 },
        shortExcess: 0,
      });
    });
  });

  describe('getDailySalesReport — sales', () => {
    it('computes litres and value for a single fuel/single shift, using the rate at shiftEnd', async () => {
      const shift1 = { id: 'shift-1', label: 'Shift 1', startTime: '06:00', endTime: '14:00', isActive: true };
      prisma.shiftDefinition.findMany.mockResolvedValue([shift1]);
      const shiftEnd = new Date(2026, 6, 20, 13, 0);
      prisma.meterReading.findMany.mockResolvedValue([
        reading({
          id: 'r1',
          openingReading: 1000,
          closingReading: 1300,
          shiftStart: new Date(2026, 6, 20, 6, 0),
          shiftEnd,
        }),
      ]);
      rateMaster.getCurrentRate.mockResolvedValue({ rate: 90 });

      const result = await service.getDailySalesReport('2026-07-20');

      expect(result.fuels).toEqual([
        {
          productType: 'Diesel',
          shifts: [{ shiftDefinitionId: 'shift-1', label: 'Shift 1', litres: 300, value: 27000 }],
          totalLitres: 300,
          totalValue: 27000,
        },
      ]);
      expect(rateMaster.getCurrentRate).toHaveBeenCalledWith('Diesel', shiftEnd);
    });

    it('rolls up two shifts on the same fuel into one fuel-wise total', async () => {
      const shift1 = { id: 'shift-1', label: 'Shift 1', startTime: '06:00', endTime: '14:00', isActive: true };
      const shift2 = { id: 'shift-2', label: 'Shift 2', startTime: '14:00', endTime: '22:00', isActive: true };
      prisma.shiftDefinition.findMany.mockResolvedValue([shift1, shift2]);
      prisma.meterReading.findMany.mockResolvedValue([
        reading({
          id: 'r1',
          openingReading: 1000,
          closingReading: 1200,
          shiftStart: new Date(2026, 6, 20, 7, 0),
          shiftEnd: new Date(2026, 6, 20, 13, 0),
        }),
        reading({
          id: 'r2',
          openingReading: 1200,
          closingReading: 1500,
          shiftStart: new Date(2026, 6, 20, 15, 0),
          shiftEnd: new Date(2026, 6, 20, 21, 0),
        }),
      ]);
      rateMaster.getCurrentRate.mockResolvedValue({ rate: 100 });

      const result = await service.getDailySalesReport('2026-07-20');

      expect(result.fuels).toHaveLength(1);
      expect(result.fuels[0].shifts).toHaveLength(2);
      expect(result.fuels[0].totalLitres).toBe(500); // 200 + 300
      expect(result.fuels[0].totalValue).toBe(50000);
    });

    it('buckets a reading matching no configured shift window into "Unassigned"', async () => {
      const shift1 = { id: 'shift-1', label: 'Shift 1', startTime: '06:00', endTime: '14:00', isActive: true };
      prisma.shiftDefinition.findMany.mockResolvedValue([shift1]);
      prisma.meterReading.findMany.mockResolvedValue([
        reading({
          id: 'r1',
          openingReading: 1000,
          closingReading: 1100,
          shiftStart: new Date(2026, 6, 20, 20, 0),
          shiftEnd: new Date(2026, 6, 20, 21, 0),
        }),
      ]);
      rateMaster.getCurrentRate.mockResolvedValue({ rate: 90 });

      const result = await service.getDailySalesReport('2026-07-20');

      expect(result.fuels[0].shifts[0]).toMatchObject({ shiftDefinitionId: null, label: 'Unassigned' });
    });

    it('reports value: null (not a thrown error) when no Rate Master entry covers the shift', async () => {
      prisma.meterReading.findMany.mockResolvedValue([
        reading({
          id: 'r1',
          openingReading: 1000,
          closingReading: 1100,
          shiftStart: new Date(2026, 6, 20, 7, 0),
          shiftEnd: new Date(2026, 6, 20, 13, 0),
        }),
      ]);
      rateMaster.getCurrentRate.mockRejectedValue(new Error('no rate configured'));

      const result = await service.getDailySalesReport('2026-07-20');

      expect(result.fuels[0].shifts[0].value).toBeNull();
      expect(result.fuels[0].totalValue).toBe(0);
    });
  });

  describe('getDailySalesReport — stock movement', () => {
    const tankRow = { id: 'tank-1', tankNumber: 'T1', productType: 'Diesel', currentStockLitres: 5000 };

    it('uses the physical DipReading when one exists that day (Measured)', async () => {
      prisma.tank.findMany.mockResolvedValue([tankRow]);
      prisma.dipReading.findMany.mockResolvedValue([
        { tankId: 'tank-1', reading: 4800, createdAt: new Date(2026, 6, 20, 20, 0) },
      ]);

      const result = await service.getDailySalesReport('2026-07-20');

      expect(result.stockMovement[0].closingStock).toBe(4800);
      expect(result.stockMovement[0].closingStockProvenance).toBe('MEASURED');
    });

    it('falls back to the live Tank counter (Computed) when no dip exists and the date is today', async () => {
      prisma.tank.findMany.mockResolvedValue([tankRow]);

      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const result = await service.getDailySalesReport(todayStr);

      expect(result.stockMovement[0].closingStock).toBe(5000);
      expect(result.stockMovement[0].closingStockProvenance).toBe('COMPUTED');
    });

    it('reports Unavailable (not a guess) when no dip exists and the date is in the past', async () => {
      prisma.tank.findMany.mockResolvedValue([tankRow]);

      const result = await service.getDailySalesReport('2020-01-01');

      expect(result.stockMovement[0].closingStock).toBeNull();
      expect(result.stockMovement[0].closingStockProvenance).toBe('UNAVAILABLE');
      expect(result.stockMovement[0].openingStock).toBeNull();
      expect(result.stockMovement[0].openingStockProvenance).toBe('UNAVAILABLE');
    });

    it('nets receipts and sales into opening stock (closing - receipts + sales)', async () => {
      prisma.tank.findMany.mockResolvedValue([tankRow]);
      prisma.dipReading.findMany.mockResolvedValue([
        { tankId: 'tank-1', reading: 4800, createdAt: new Date(2026, 6, 20, 20, 0) },
      ]);
      prisma.purchaseEntry.findMany.mockResolvedValue([
        { productType: 'Diesel', quantityLitres: 1000 },
      ]);
      prisma.meterReading.findMany.mockResolvedValue([
        reading({
          id: 'r1',
          openingReading: 1000,
          closingReading: 1300,
          shiftStart: new Date(2026, 6, 20, 7, 0),
          shiftEnd: new Date(2026, 6, 20, 13, 0),
        }),
      ]);
      rateMaster.getCurrentRate.mockResolvedValue({ rate: 90 });

      const result = await service.getDailySalesReport('2026-07-20');

      expect(result.stockMovement[0].receipts).toBe(1000);
      expect(result.stockMovement[0].sales).toBe(300);
      // opening = closing(4800) - receipts(1000) + sales(300) = 4100
      expect(result.stockMovement[0].openingStock).toBe(4100);
    });

    it('resolves nozzle -> tank via nozzle.tankId when set, else falls back to productType match', async () => {
      const tankA = { id: 'tank-a', tankNumber: 'T1', productType: 'Diesel', currentStockLitres: 0 };
      const tankB = { id: 'tank-b', tankNumber: 'T2', productType: 'Diesel', currentStockLitres: 0 };
      prisma.tank.findMany.mockResolvedValue([tankA, tankB]);
      prisma.meterReading.findMany.mockResolvedValue([
        reading({
          id: 'r1',
          openingReading: 0,
          closingReading: 100,
          shiftStart: new Date(2026, 6, 20, 7, 0),
          shiftEnd: new Date(2026, 6, 20, 13, 0),
          nozzle: nozzle({ tankId: 'tank-b', itemName: 'Diesel' }), // explicit link wins over first-productType-match
        }),
      ]);
      rateMaster.getCurrentRate.mockResolvedValue({ rate: 90 });

      const result = await service.getDailySalesReport('2020-01-01');

      const tankARow = result.stockMovement.find((t) => t.tankId === 'tank-a')!;
      const tankBRow = result.stockMovement.find((t) => t.tankId === 'tank-b')!;
      expect(tankARow.sales).toBe(0);
      expect(tankBRow.sales).toBe(100);
    });
  });

  describe('getDailySalesReport — collections and short/excess', () => {
    it('combines Bill payment lines and ShiftSalesSummary fields additively, without double-counting', async () => {
      prisma.bill.findMany.mockResolvedValue([
        {
          paymentLines: [
            { paymentType: 'CASH', amount: 500, direction: 'IN' },
            { paymentType: 'CREDIT', amount: 200, direction: 'IN' },
          ],
        },
      ]);
      prisma.shiftSalesSummary.findMany.mockResolvedValue([
        { walkInCashCollected: 1000, walkInCardCollected: 300, walkInUpiCollected: 150, variance: -20 },
        { walkInCashCollected: 400, walkInCardCollected: 0, walkInUpiCollected: 50, variance: 5 },
      ]);

      const result = await service.getDailySalesReport('2026-07-20');

      expect(result.collections).toEqual({
        cash: 500 + 1000 + 400, // Bill CASH + both ShiftSalesSummary rows
        card: 0 + 300 + 0,
        upi: 0 + 150 + 50,
        credit: 200, // ShiftSalesSummary has no credit field — Bill-only
      });
      expect(result.shortExcess).toBe(-15); // -20 + 5
    });
  });
});
