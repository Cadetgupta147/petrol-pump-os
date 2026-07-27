import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { TaxRateConfigService } from './tax-rate-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { runInTenantContext } from '../common/tenant-context';

// Section 17.22 — dealer-configurable GST rate, replacing the "no tax field
// at all" gap in sales-purchase-register.service.ts. Covers: the create-vs-
// update branch, the P2002 race, and resolveTaxRateMap()'s map-building
// (used directly by SalesPurchaseRegisterService).
describe('TaxRateConfigService', () => {
  let service: TaxRateConfigService;
  let prisma: {
    taxRateConfig: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const PUMP_ID = 'pump-1';

  beforeEach(async () => {
    prisma = {
      taxRateConfig: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TaxRateConfigService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(TaxRateConfigService);
  });

  describe('upsert', () => {
    it('creates a new row when none exists yet for this productType', async () => {
      prisma.taxRateConfig.findFirst.mockResolvedValue(null);
      prisma.taxRateConfig.create.mockResolvedValue({ id: 'trc-1' });

      await runInTenantContext({ pumpId: PUMP_ID }, () =>
        service.upsert({ productType: 'lubricant', taxRatePercent: 18 }),
      );

      expect(prisma.taxRateConfig.create).toHaveBeenCalledWith({
        data: { pumpId: PUMP_ID, productType: 'lubricant', taxRatePercent: 18 },
      });
    });

    it('updates the existing row when one already exists for this productType', async () => {
      prisma.taxRateConfig.findFirst.mockResolvedValue({ id: 'trc-1', productType: 'lubricant' });
      prisma.taxRateConfig.update.mockResolvedValue({ id: 'trc-1' });

      await service.upsert({ productType: 'lubricant', taxRatePercent: 12 });

      expect(prisma.taxRateConfig.update).toHaveBeenCalledWith({
        where: { id: 'trc-1' },
        data: { taxRatePercent: 12 },
      });
    });

    it('accepts a 0% rate as an explicit "untaxed" marker, distinct from no row at all', async () => {
      prisma.taxRateConfig.findFirst.mockResolvedValue(null);
      prisma.taxRateConfig.create.mockResolvedValue({ id: 'trc-1' });

      await runInTenantContext({ pumpId: PUMP_ID }, () =>
        service.upsert({ productType: 'petrol', taxRatePercent: 0 }),
      );

      expect(prisma.taxRateConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ taxRatePercent: 0 }) }),
      );
    });

    it('translates a P2002 race-to-create into a 409 Conflict', async () => {
      prisma.taxRateConfig.findFirst.mockResolvedValue(null);
      prisma.taxRateConfig.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique constraint', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        runInTenantContext({ pumpId: PUMP_ID }, () =>
          service.upsert({ productType: 'lubricant', taxRatePercent: 18 }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('resolveTaxRateMap', () => {
    it('builds a productType -> rate map from configured rows', async () => {
      prisma.taxRateConfig.findMany.mockResolvedValue([
        { productType: 'lubricant', taxRatePercent: 18 },
        { productType: 'urea', taxRatePercent: 5 },
      ]);

      const map = await service.resolveTaxRateMap();

      expect(map).toEqual({ lubricant: 18, urea: 5 });
    });

    it('returns an empty map when nothing is configured', async () => {
      prisma.taxRateConfig.findMany.mockResolvedValue([]);

      const map = await service.resolveTaxRateMap();

      expect(map).toEqual({});
    });
  });
});
