import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TanksService, DIP_VARIANCE_TOLERANCE_LITRES } from './tanks.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 7.1/7.2 — rule-heavy logic per CLAUDE.md ("stock variance flagging"
// is explicitly named). Covers: DIP reading variance math + the tolerance
// flag boundary, systemStockAtReading captured from the tank at write time
// (not confused with the physical `reading`), and the variance report shape.
describe('TanksService', () => {
  let service: TanksService;

  type TxCallback = (tx: unknown) => Promise<unknown>;

  let prisma: {
    tank: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    dipReading: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const tank = {
    id: 'tank-1',
    productType: 'petrol',
    capacityLitres: 10000,
    currentStockLitres: 5000,
    lastDipReading: null,
    lastDipAt: null,
    calibrationChartRef: null,
  };

  beforeEach(async () => {
    prisma = {
      tank: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      dipReading: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn((cb: TxCallback) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TanksService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(TanksService);
  });

  describe('recordDipReading', () => {
    it('404s on an unknown tankId', async () => {
      prisma.tank.findUnique.mockResolvedValue(null);

      await expect(
        service.recordDipReading('nope', { reading: 100, staffId: 's1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('computes variance = systemStockAtReading - reading and captures the tank snapshot atomically', async () => {
      prisma.tank.findUnique.mockResolvedValue(tank);
      prisma.tank.findUniqueOrThrow.mockResolvedValue(tank); // currentStockLitres: 5000
      prisma.dipReading.create.mockResolvedValue({
        id: 'dip-1',
        tankId: 'tank-1',
        recordedById: 's1',
        reading: 4990,
        systemStockAtReading: 5000,
        variance: 10,
        flagged: true, // 10 > DIP_VARIANCE_TOLERANCE_LITRES (5)
        createdAt: new Date('2026-07-20T00:00:00Z'),
      });
      prisma.tank.update.mockResolvedValue({});

      await service.recordDipReading('tank-1', { reading: 4990, staffId: 's1' });

      expect(prisma.dipReading.create).toHaveBeenCalledWith({
        data: {
          tankId: 'tank-1',
          recordedById: 's1',
          reading: 4990,
          systemStockAtReading: 5000,
          variance: 10,
          flagged: true,
        },
      });
      // Tank.lastDipReading/lastDipAt kept in sync for the existing dashboard KPI.
      expect(prisma.tank.update).toHaveBeenCalledWith({
        where: { id: 'tank-1' },
        data: {
          lastDipReading: 4990,
          lastDipAt: new Date('2026-07-20T00:00:00Z'),
        },
      });
    });

    it('does not flag a variance exactly at the tolerance boundary', async () => {
      prisma.tank.findUnique.mockResolvedValue(tank);
      prisma.tank.findUniqueOrThrow.mockResolvedValue(tank); // 5000
      const readingAtBoundary = 5000 - DIP_VARIANCE_TOLERANCE_LITRES; // variance === tolerance exactly
      prisma.dipReading.create.mockImplementation(
        (args: { data: { variance: number; flagged: boolean } }) =>
          Promise.resolve({ id: 'dip-1', createdAt: new Date(), ...args.data }),
      );
      prisma.tank.update.mockResolvedValue({});

      await service.recordDipReading('tank-1', {
        reading: readingAtBoundary,
        staffId: 's1',
      });

      expect(prisma.dipReading.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            variance: DIP_VARIANCE_TOLERANCE_LITRES,
            flagged: false, // strictly-greater-than tolerance, not >=
          }) as unknown,
        }),
      );
    });

    it('flags a variance just past the tolerance boundary', async () => {
      prisma.tank.findUnique.mockResolvedValue(tank);
      prisma.tank.findUniqueOrThrow.mockResolvedValue(tank); // 5000
      const readingJustPast = 5000 - DIP_VARIANCE_TOLERANCE_LITRES - 0.01;
      prisma.dipReading.create.mockImplementation(
        (args: { data: { variance: number; flagged: boolean } }) =>
          Promise.resolve({ id: 'dip-1', createdAt: new Date(), ...args.data }),
      );
      prisma.tank.update.mockResolvedValue({});

      await service.recordDipReading('tank-1', {
        reading: readingJustPast,
        staffId: 's1',
      });

      expect(prisma.dipReading.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ flagged: true }) as unknown,
        }),
      );
    });

    it('flags an excess (negative variance) past the tolerance boundary the same as a shortage', async () => {
      prisma.tank.findUnique.mockResolvedValue(tank);
      prisma.tank.findUniqueOrThrow.mockResolvedValue(tank); // 5000
      const readingWayOver = 5000 + DIP_VARIANCE_TOLERANCE_LITRES + 1; // stick found MORE than system expects
      prisma.dipReading.create.mockImplementation(
        (args: { data: { variance: number; flagged: boolean } }) =>
          Promise.resolve({ id: 'dip-1', createdAt: new Date(), ...args.data }),
      );
      prisma.tank.update.mockResolvedValue({});

      await service.recordDipReading('tank-1', {
        reading: readingWayOver,
        staffId: 's1',
      });

      expect(prisma.dipReading.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            variance: -(DIP_VARIANCE_TOLERANCE_LITRES + 1),
            flagged: true,
          }) as unknown,
        }),
      );
    });
  });

  describe('varianceReport', () => {
    it('returns the latest DIP reading per tank, and null for a tank never dipped', async () => {
      prisma.tank.findMany.mockResolvedValue([
        {
          ...tank,
          id: 'tank-1',
          dipReadings: [
            {
              id: 'dip-2',
              reading: 4990,
              systemStockAtReading: 5000,
              variance: 10,
              flagged: false,
              createdAt: new Date('2026-07-20T00:00:00Z'),
            },
          ],
        },
        {
          ...tank,
          id: 'tank-2',
          productType: 'diesel',
          dipReadings: [],
        },
      ]);

      const report = await service.varianceReport();

      expect(report).toEqual([
        expect.objectContaining({
          tankId: 'tank-1',
          latestDipReading: expect.objectContaining({ variance: 10, flagged: false }) as unknown,
        }),
        expect.objectContaining({ tankId: 'tank-2', latestDipReading: null }),
      ]);
    });
  });
});
