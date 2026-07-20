import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  computeDensityFlag,
  DENSITY_RANGE_BY_PRODUCT,
  DensityLogsService,
} from './density-logs.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 7.3 — rule-heavy logic per CLAUDE.md ("stock variance flagging" is
// named explicitly; density range-flagging is the same category of check).
// Covers: in-range not flagged, out-of-range flagged (both directions), and
// an unknown product never being flagged (documented behavior — see
// DENSITY_RANGE_BY_PRODUCT's comment).
describe('computeDensityFlag', () => {
  it('does not flag a value within the configured range', () => {
    expect(computeDensityFlag('petrol', 0.75)).toBe(false);
  });

  it('flags a value below the configured minimum', () => {
    const belowMin = DENSITY_RANGE_BY_PRODUCT.petrol.min - 0.01;
    expect(computeDensityFlag('petrol', belowMin)).toBe(true);
  });

  it('flags a value above the configured maximum', () => {
    const aboveMax = DENSITY_RANGE_BY_PRODUCT.diesel.max + 0.01;
    expect(computeDensityFlag('diesel', aboveMax)).toBe(true);
  });

  it('does not flag a value exactly at the boundary (inclusive range)', () => {
    expect(
      computeDensityFlag('petrol', DENSITY_RANGE_BY_PRODUCT.petrol.min),
    ).toBe(false);
    expect(
      computeDensityFlag('petrol', DENSITY_RANGE_BY_PRODUCT.petrol.max),
    ).toBe(false);
  });

  it('never flags a product with no configured range — documented behavior, not a bug', () => {
    expect(computeDensityFlag('kerosene', 999)).toBe(false);
    expect(computeDensityFlag('kerosene', -999)).toBe(false);
  });
});

describe('DensityLogsService', () => {
  let service: DensityLogsService;
  let prisma: {
    tank: { findUnique: jest.Mock };
    densityLog: { create: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      tank: { findUnique: jest.fn() },
      densityLog: { create: jest.fn(), findMany: jest.fn() },
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
        service.create({
          tankId: 'nope',
          densityValue: 0.75,
          recordedById: 's1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.densityLog.create).not.toHaveBeenCalled();
    });

    it('computes flagged from the tank productType and persists the linkage fields', async () => {
      prisma.tank.findUnique.mockResolvedValue({
        id: 'tank-1',
        productType: 'petrol',
      });
      prisma.densityLog.create.mockResolvedValue({ id: 'dl-1' });

      await service.create({
        tankId: 'tank-1',
        densityValue: 0.5, // below MS range -> flagged
        ppmValue: 10,
        recordedById: 's1',
        purchaseEntryId: 'pe-1',
        dipReadingId: 'dip-1',
      });

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
