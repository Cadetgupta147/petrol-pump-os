import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GiftCatalogService } from './gift-catalog.service';
import { PrismaService } from '../prisma/prisma.service';

// jest's asymmetric matchers are typed `any`; this wrapper gives them an
// `unknown` type so they can sit inside object-literal expectations without
// tripping @typescript-eslint/no-unsafe-assignment (same helper as
// bills-loyalty.spec.ts).
const containing = (shape: Record<string, unknown>): unknown =>
  expect.objectContaining(shape) as unknown;

// Section 6.4 Lever 2 — gift catalog CRUD. The rule-heavy part of this slice
// (CLAUDE.md: write tests for rule-heavy logic) is that "remove" must be a
// soft-retire (activeFlag: false), never a hard delete, because
// RedemptionTransaction.giftItemId has an FK to this table and Section 6.4
// requires retiring a gift without losing its redemption history.
describe('GiftCatalogService', () => {
  let service: GiftCatalogService;
  let prisma: {
    giftCatalogItem: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    redemptionTransaction: { groupBy: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      giftCatalogItem: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      redemptionTransaction: { groupBy: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GiftCatalogService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(GiftCatalogService);
  });

  describe('create', () => {
    it('defaults activeFlag to true when omitted', async () => {
      prisma.giftCatalogItem.create.mockResolvedValue({});

      await service.create({
        giftName: 'Engine Oil 1L',
        pointsRequired: 100,
      });

      expect(prisma.giftCatalogItem.create).toHaveBeenCalledWith({
        data: containing({ activeFlag: true }),
      });
    });

    it('leaves stockQuantity untracked (undefined -> Prisma default) when omitted', async () => {
      prisma.giftCatalogItem.create.mockResolvedValue({});

      await service.create({
        giftName: 'Branded Cap',
        pointsRequired: 50,
      });

      expect(prisma.giftCatalogItem.create).toHaveBeenCalledWith({
        data: containing({ stockQuantity: undefined }),
      });
    });

    it('passes through an explicit stockQuantity when tracked', async () => {
      prisma.giftCatalogItem.create.mockResolvedValue({});

      await service.create({
        giftName: 'Travel Mug',
        pointsRequired: 75,
        stockQuantity: 20,
      });

      expect(prisma.giftCatalogItem.create).toHaveBeenCalledWith({
        data: containing({ stockQuantity: 20 }),
      });
    });
  });

  describe('update', () => {
    it('404s on an unknown id before attempting the update', async () => {
      prisma.giftCatalogItem.findUnique.mockResolvedValue(null);

      await expect(
        service.update('nope', { giftName: 'New Name' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.giftCatalogItem.update).not.toHaveBeenCalled();
    });

    it('only writes the fields provided', async () => {
      prisma.giftCatalogItem.findUnique.mockResolvedValue({ id: 'gift-1' });
      prisma.giftCatalogItem.update.mockResolvedValue({});

      await service.update('gift-1', { pointsRequired: 200 });

      expect(prisma.giftCatalogItem.update).toHaveBeenCalledWith({
        where: { id: 'gift-1' },
        data: { pointsRequired: 200 },
      });
    });
  });

  describe('remove — Section 6.4 soft-retire', () => {
    it('sets activeFlag to false rather than deleting the row', async () => {
      prisma.giftCatalogItem.findUnique.mockResolvedValue({ id: 'gift-1' });
      prisma.giftCatalogItem.update.mockResolvedValue({
        id: 'gift-1',
        activeFlag: false,
      });

      const result = await service.remove('gift-1');

      expect(prisma.giftCatalogItem.update).toHaveBeenCalledWith({
        where: { id: 'gift-1' },
        data: { activeFlag: false },
      });
      expect(result.activeFlag).toBe(false);
    });

    it('404s on an unknown id', async () => {
      prisma.giftCatalogItem.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // Section 12 — Gift Redemption Report.
  describe('getRedemptionReport', () => {
    it('includes every catalog item, even ones never redeemed, and sorts most-redeemed first', async () => {
      prisma.giftCatalogItem.findMany.mockResolvedValue([
        {
          id: 'gift-cap',
          giftName: 'Branded Cap',
          pointsRequired: 50,
          stockQuantity: 10,
          activeFlag: true,
        },
        {
          id: 'gift-mug',
          giftName: 'Travel Mug',
          pointsRequired: 75,
          stockQuantity: 5,
          activeFlag: true,
        },
      ]);
      prisma.redemptionTransaction.groupBy.mockResolvedValue([
        { giftItemId: 'gift-mug', _count: { _all: 3 }, _sum: { pointsSpent: 225 } },
      ]);

      const report = await service.getRedemptionReport();

      expect(report).toEqual([
        {
          giftItemId: 'gift-mug',
          giftName: 'Travel Mug',
          pointsRequired: 75,
          stockQuantity: 5,
          activeFlag: true,
          timesRedeemed: 3,
          totalPointsSpent: 225,
        },
        {
          giftItemId: 'gift-cap',
          giftName: 'Branded Cap',
          pointsRequired: 50,
          stockQuantity: 10,
          activeFlag: true,
          timesRedeemed: 0,
          totalPointsSpent: 0,
        },
      ]);
    });

    it('queries groupBy scoped to GIFT redemptions only', async () => {
      prisma.giftCatalogItem.findMany.mockResolvedValue([]);
      prisma.redemptionTransaction.groupBy.mockResolvedValue([]);

      await service.getRedemptionReport();

      expect(prisma.redemptionTransaction.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { redemptionType: 'GIFT', giftItemId: { not: null } },
        }),
      );
    });
  });
});
