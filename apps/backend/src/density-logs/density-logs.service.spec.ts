import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  computeDensityFlag,
  DEFAULT_DENSITY_RANGE_BY_PRODUCT,
  DensityLogsService,
  resolveDensityRangeMap,
} from './density-logs.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 7.3 — rule-heavy logic per CLAUDE.md ("stock variance flagging" is
// named explicitly; density range-flagging is the same category of check).
// Covers: in-range not flagged, out-of-range flagged (both directions), and
// an unknown product never being flagged (documented behavior — see
// DEFAULT_DENSITY_RANGE_BY_PRODUCT's comment).
describe('computeDensityFlag', () => {
  it('does not flag a value within the configured range', () => {
    expect(computeDensityFlag('petrol', 0.75)).toBe(false);
  });

  it('flags a value below the configured minimum', () => {
    const belowMin = DEFAULT_DENSITY_RANGE_BY_PRODUCT.petrol.min - 0.01;
    expect(computeDensityFlag('petrol', belowMin)).toBe(true);
  });

  it('flags a value above the configured maximum', () => {
    const aboveMax = DEFAULT_DENSITY_RANGE_BY_PRODUCT.diesel.max + 0.01;
    expect(computeDensityFlag('diesel', aboveMax)).toBe(true);
  });

  it('does not flag a value exactly at the boundary (inclusive range)', () => {
    expect(
      computeDensityFlag('petrol', DEFAULT_DENSITY_RANGE_BY_PRODUCT.petrol.min),
    ).toBe(false);
    expect(
      computeDensityFlag('petrol', DEFAULT_DENSITY_RANGE_BY_PRODUCT.petrol.max),
    ).toBe(false);
  });

  it('never flags a product with no configured range — documented behavior, not a bug', () => {
    expect(computeDensityFlag('kerosene', 999)).toBe(false);
    expect(computeDensityFlag('kerosene', -999)).toBe(false);
  });
});

describe('resolveDensityRangeMap', () => {
  it('falls back to the default map when no DensityRangeConfig rows exist', async () => {
    const prisma = { densityRangeConfig: { findMany: jest.fn().mockResolvedValue([]) } };

    const map = await resolveDensityRangeMap(prisma as never);

    expect(map).toEqual(DEFAULT_DENSITY_RANGE_BY_PRODUCT);
  });

  it('lets a configured row override the default for that product', async () => {
    const prisma = {
      densityRangeConfig: {
        findMany: jest.fn().mockResolvedValue([
          { productType: 'petrol', minDensity: 0.7, maxDensity: 0.8 },
        ]),
      },
    };

    const map = await resolveDensityRangeMap(prisma as never);

    expect(map.petrol).toEqual({ min: 0.7, max: 0.8 });
    expect(map.diesel).toEqual(DEFAULT_DENSITY_RANGE_BY_PRODUCT.diesel);
  });

  it('adds a configured row for a product with no built-in default', async () => {
    const prisma = {
      densityRangeConfig: {
        findMany: jest.fn().mockResolvedValue([
          { productType: 'kerosene', minDensity: 0.78, maxDensity: 0.82 },
        ]),
      },
    };

    const map = await resolveDensityRangeMap(prisma as never);

    expect(map.kerosene).toEqual({ min: 0.78, max: 0.82 });
  });
});

describe('DensityLogsService', () => {
  let service: DensityLogsService;
  let prisma: {
    tank: { findUnique: jest.Mock };
    densityLog: { create: jest.Mock; findMany: jest.Mock };
    densityRangeConfig: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      tank: { findUnique: jest.fn() },
      densityLog: { create: jest.fn(), findMany: jest.fn() },
      densityRangeConfig: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DensityLogsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DensityLogsService);
  });

  describe('create', () => {
    it('404s on an unknown tankId', async () => {
      prisma.tank.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ tankId: 'nope', densityValue: 0.75 }, 's1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.densityLog.create).not.toHaveBeenCalled();
    });

    it('computes flagged from the tank productType and persists the linkage fields', async () => {
      prisma.tank.findUnique.mockResolvedValue({
        id: 'tank-1',
        productType: 'petrol',
      });
      prisma.densityLog.create.mockResolvedValue({ id: 'dl-1' });

      await service.create(
        {
          tankId: 'tank-1',
          densityValue: 0.5, // below MS range -> flagged
          ppmValue: 10,
          purchaseEntryId: 'pe-1',
          dipReadingId: 'dip-1',
        },
        's1',
      );

      expect(prisma.densityLog.create).toHaveBeenCalledWith({
        data: {
          tankId: 'tank-1',
          densityValue: 0.5,
          ppmValue: 10,
          recordedById: 's1',
          purchaseEntryId: 'pe-1',
          dipReadingId: 'dip-1',
          flagged: true,
        },
      });
    });

    it('uses a configured DensityRangeConfig override instead of the default range', async () => {
      prisma.tank.findUnique.mockResolvedValue({ id: 'tank-1', productType: 'petrol' });
      prisma.densityRangeConfig.findMany.mockResolvedValue([
        { productType: 'petrol', minDensity: 0.4, maxDensity: 0.9 },
      ]);
      prisma.densityLog.create.mockResolvedValue({ id: 'dl-1' });

      // 0.5 is below the built-in default min (0.72) but within the
      // configured override (0.4-0.9) — must NOT be flagged.
      await service.create({ tankId: 'tank-1', densityValue: 0.5 }, 's1');

      expect(prisma.densityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ flagged: false }) }),
      );
    });
  });

  describe('findAll', () => {
    it('filters by whichever params are provided, ordered by recordedAt desc', async () => {
      prisma.densityLog.findMany.mockResolvedValue([]);

      await service.findAll({ tankId: 'tank-1' });

      expect(prisma.densityLog.findMany).toHaveBeenCalledWith({
        where: { tankId: 'tank-1' },
        orderBy: { recordedAt: 'desc' },
      });
    });

    it('applies no filters when nothing is provided', async () => {
      prisma.densityLog.findMany.mockResolvedValue([]);

      await service.findAll({});

      expect(prisma.densityLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { recordedAt: 'desc' },
      });
    });
  });
});
