import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { DensityRangeConfigService } from './density-range-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../common/tenant-context';

// Section 17.19 — dealer-configurable density range, replacing the hardcoded
// placeholder in density-logs.service.ts. Covers: min < max validation, the
// create-vs-update branch (no existing row for this productType vs. one
// already there), and the P2002 race-to-create case.
describe('DensityRangeConfigService', () => {
  let service: DensityRangeConfigService;
  let prisma: {
    densityRangeConfig: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const PUMP_ID = 'pump-1';

  beforeEach(async () => {
    prisma = {
      densityRangeConfig: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DensityRangeConfigService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DensityRangeConfigService);
  });

  describe('upsert', () => {
    it('rejects minDensity >= maxDensity before touching the database', async () => {
      await expect(
        service.upsert({ productType: 'petrol', minDensity: 0.8, maxDensity: 0.7 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.densityRangeConfig.findFirst).not.toHaveBeenCalled();
    });

    it('creates a new row when none exists yet for this productType', async () => {
      prisma.densityRangeConfig.findFirst.mockResolvedValue(null);
      prisma.densityRangeConfig.create.mockResolvedValue({ id: 'drc-1' });

      await runInTenantContext({ pumpId: PUMP_ID }, () =>
        service.upsert({ productType: 'petrol', minDensity: 0.72, maxDensity: 0.775 }),
      );

      expect(prisma.densityRangeConfig.create).toHaveBeenCalledWith({
        data: { pumpId: PUMP_ID, productType: 'petrol', minDensity: 0.72, maxDensity: 0.775 },
      });
      expect(prisma.densityRangeConfig.update).not.toHaveBeenCalled();
    });

    it('updates the existing row when one already exists for this productType', async () => {
      prisma.densityRangeConfig.findFirst.mockResolvedValue({ id: 'drc-1', productType: 'petrol' });
      prisma.densityRangeConfig.update.mockResolvedValue({ id: 'drc-1' });

      await service.upsert({ productType: 'petrol', minDensity: 0.72, maxDensity: 0.78 });

      expect(prisma.densityRangeConfig.update).toHaveBeenCalledWith({
        where: { id: 'drc-1' },
        data: { minDensity: 0.72, maxDensity: 0.78 },
      });
      expect(prisma.densityRangeConfig.create).not.toHaveBeenCalled();
    });

    it('translates a P2002 race-to-create into a 409 Conflict', async () => {
      prisma.densityRangeConfig.findFirst.mockResolvedValue(null);
      prisma.densityRangeConfig.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique constraint', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        runInTenantContext({ pumpId: PUMP_ID }, () =>
          service.upsert({ productType: 'petrol', minDensity: 0.72, maxDensity: 0.775 }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAll', () => {
    it('orders by productType', async () => {
      prisma.densityRangeConfig.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prisma.densityRangeConfig.findMany).toHaveBeenCalledWith({
        orderBy: { productType: 'asc' },
      });
    });
  });
});
