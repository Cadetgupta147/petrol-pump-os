import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RedemptionType } from '@prisma/client';
import { RedemptionsService } from './redemptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GiftCatalogService } from '../gift-catalog/gift-catalog.service';

// jest's asymmetric matchers are typed `any`; this wrapper gives them an
// `unknown` type so they can sit inside object-literal expectations without
// tripping @typescript-eslint/no-unsafe-assignment (same helper as
// bills-loyalty.spec.ts).
const containing = (shape: Record<string, unknown>): unknown =>
  expect.objectContaining(shape) as unknown;

// Section 6.4 (redemption policy) + 6.6 (counter redemption flow) — rule
// heavy money/points logic (CLAUDE.md: write tests for rule-heavy logic).
// Covers: all three redemptionTypeAllowed operating modes and their
// mismatch-rejection cases, balance/threshold enforcement, gift-branch
// stock/active-flag rules (including untracked stock), and cash-branch
// ratio/value computation.
describe('RedemptionsService', () => {
  let service: RedemptionsService;
  let prisma: {
    customer: { findUnique: jest.Mock };
    loyaltyTransaction: { aggregate: jest.Mock };
    $transaction: jest.Mock;
  };
  let loyaltyService: { getConfig: jest.Mock; getBalance: jest.Mock };
  let giftCatalogService: { findOne: jest.Mock };
  let tx: {
    loyaltyTransaction: { aggregate: jest.Mock; create: jest.Mock };
    giftCatalogItem: { updateMany: jest.Mock };
    redemptionTransaction: { create: jest.Mock };
  };

  const customer = { id: 'cust-1', name: 'Test Customer' };

  const cashOnlyConfig = {
    id: 'singleton',
    earningBasis: 'RUPEE',
    defaultRate: 2,
    redemptionTypeAllowed: RedemptionType.CASH,
    customerCanChooseRedemption: false,
    defaultRedemptionMode: null,
    cashRedemptionRatio: 1, // 1 point = ₹1
    minRedeemablePoints: null,
  };

  const giftOnlyConfig = {
    ...cashOnlyConfig,
    redemptionTypeAllowed: RedemptionType.GIFT,
  };

  const bothCustomerChoosesConfig = {
    ...cashOnlyConfig,
    redemptionTypeAllowed: RedemptionType.BOTH,
    customerCanChooseRedemption: true,
  };

  const bothDealerDefaultConfig = {
    ...cashOnlyConfig,
    redemptionTypeAllowed: RedemptionType.BOTH,
    customerCanChooseRedemption: false,
    defaultRedemptionMode: RedemptionType.GIFT,
  };

  const gift = {
    id: 'gift-1',
    giftName: 'Travel Mug',
    imageUrl: null,
    pointsRequired: 100,
    stockQuantity: 5,
    activeFlag: true,
  };

  beforeEach(async () => {
    tx = {
      loyaltyTransaction: { aggregate: jest.fn(), create: jest.fn() },
      giftCatalogItem: { updateMany: jest.fn() },
      redemptionTransaction: { create: jest.fn() },
    };

    prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue(customer) },
      loyaltyTransaction: { aggregate: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };

    loyaltyService = { getConfig: jest.fn(), getBalance: jest.fn() };
    giftCatalogService = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedemptionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoyaltyService, useValue: loyaltyService },
        { provide: GiftCatalogService, useValue: giftCatalogService },
      ],
    }).compile();

    service = module.get(RedemptionsService);
  });

  function mockBalance(points: number) {
    // Pre-check balance now goes through LoyaltyService.getBalance() (see
    // the refactor pulling getBalance() up out of RedemptionsService); the
    // in-transaction re-check still hits tx.loyaltyTransaction.aggregate
    // directly, unchanged.
    loyaltyService.getBalance.mockResolvedValue(points);
    prisma.loyaltyTransaction.aggregate.mockResolvedValue({
      _sum: { pointsDelta: points },
    });
    tx.loyaltyTransaction.aggregate.mockResolvedValue({
      _sum: { pointsDelta: points },
    });
  }

  describe('config gates', () => {
    it('409s when loyalty config is not set', async () => {
      loyaltyService.getConfig.mockResolvedValue(null);

      await expect(
        service.create({ customerId: 'cust-1', pointsToRedeem: 10 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('409s when redemptionTypeAllowed is not set', async () => {
      loyaltyService.getConfig.mockResolvedValue({
        ...cashOnlyConfig,
        redemptionTypeAllowed: null,
      });

      await expect(
        service.create({ customerId: 'cust-1', pointsToRedeem: 10 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s on an unknown customerId', async () => {
      loyaltyService.getConfig.mockResolvedValue(cashOnlyConfig);
      prisma.customer.findUnique.mockResolvedValue(null);
      mockBalance(500);

      await expect(
        service.create({ customerId: 'nope', pointsToRedeem: 10 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('mode 1 — redemptionTypeAllowed = CASH', () => {
    it('redeems cash without an explicit redemptionType', async () => {
      loyaltyService.getConfig.mockResolvedValue(cashOnlyConfig);
      mockBalance(500);
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await service.create({ customerId: 'cust-1', pointsToRedeem: 100 });

      expect(tx.redemptionTransaction.create).toHaveBeenCalledWith({
        data: containing({
          redemptionType: RedemptionType.CASH,
          pointsSpent: 100,
          cashValue: 100,
        }),
      });
    });

    it('rejects a GIFT request as a client-bug mismatch', async () => {
      loyaltyService.getConfig.mockResolvedValue(cashOnlyConfig);
      mockBalance(500);

      await expect(
        service.create({
          customerId: 'cust-1',
          redemptionType: RedemptionType.GIFT,
          giftItemId: 'gift-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('mode 1 — redemptionTypeAllowed = GIFT', () => {
    it('redeems a gift without an explicit redemptionType', async () => {
      loyaltyService.getConfig.mockResolvedValue(giftOnlyConfig);
      giftCatalogService.findOne.mockResolvedValue(gift);
      mockBalance(500);
      tx.giftCatalogItem.updateMany.mockResolvedValue({ count: 1 });
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await service.create({ customerId: 'cust-1', giftItemId: 'gift-1' });

      expect(tx.redemptionTransaction.create).toHaveBeenCalledWith({
        data: containing({
          redemptionType: RedemptionType.GIFT,
          pointsSpent: gift.pointsRequired,
        }),
      });
    });

    it('rejects a CASH request as a client-bug mismatch', async () => {
      loyaltyService.getConfig.mockResolvedValue(giftOnlyConfig);
      mockBalance(500);

      await expect(
        service.create({
          customerId: 'cust-1',
          redemptionType: RedemptionType.CASH,
          pointsToRedeem: 10,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('mode 2 — BOTH + customerCanChooseRedemption = true', () => {
    it('requires an explicit redemptionType', async () => {
      loyaltyService.getConfig.mockResolvedValue(bothCustomerChoosesConfig);
      mockBalance(500);

      await expect(
        service.create({ customerId: 'cust-1', pointsToRedeem: 10 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('honors the caller-chosen CASH type', async () => {
      loyaltyService.getConfig.mockResolvedValue(bothCustomerChoosesConfig);
      mockBalance(500);
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await service.create({
        customerId: 'cust-1',
        redemptionType: RedemptionType.CASH,
        pointsToRedeem: 50,
      });

      expect(tx.redemptionTransaction.create).toHaveBeenCalledWith({
        data: containing({ redemptionType: RedemptionType.CASH }),
      });
    });

    it('honors the caller-chosen GIFT type', async () => {
      loyaltyService.getConfig.mockResolvedValue(bothCustomerChoosesConfig);
      giftCatalogService.findOne.mockResolvedValue(gift);
      mockBalance(500);
      tx.giftCatalogItem.updateMany.mockResolvedValue({ count: 1 });
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await service.create({
        customerId: 'cust-1',
        redemptionType: RedemptionType.GIFT,
        giftItemId: 'gift-1',
      });

      expect(tx.redemptionTransaction.create).toHaveBeenCalledWith({
        data: containing({ redemptionType: RedemptionType.GIFT }),
      });
    });
  });

  describe('mode 3 — BOTH + customerCanChooseRedemption = false (dealer default)', () => {
    it('uses defaultRedemptionMode when no redemptionType is passed', async () => {
      loyaltyService.getConfig.mockResolvedValue(bothDealerDefaultConfig); // default = GIFT
      giftCatalogService.findOne.mockResolvedValue(gift);
      mockBalance(500);
      tx.giftCatalogItem.updateMany.mockResolvedValue({ count: 1 });
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await service.create({ customerId: 'cust-1', giftItemId: 'gift-1' });

      expect(tx.redemptionTransaction.create).toHaveBeenCalledWith({
        data: containing({ redemptionType: RedemptionType.GIFT }),
      });
    });

    it('rejects a requestedType that conflicts with the dealer default', async () => {
      loyaltyService.getConfig.mockResolvedValue(bothDealerDefaultConfig); // default = GIFT
      mockBalance(500);

      await expect(
        service.create({
          customerId: 'cust-1',
          redemptionType: RedemptionType.CASH,
          pointsToRedeem: 10,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('409s when defaultRedemptionMode is unset (misconfigured)', async () => {
      loyaltyService.getConfig.mockResolvedValue({
        ...bothDealerDefaultConfig,
        defaultRedemptionMode: null,
      });
      mockBalance(500);

      await expect(
        service.create({ customerId: 'cust-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('balance/threshold enforcement', () => {
    it('rejects when balance is below minRedeemablePoints', async () => {
      loyaltyService.getConfig.mockResolvedValue({
        ...cashOnlyConfig,
        minRedeemablePoints: 100,
      });
      mockBalance(50);

      await expect(
        service.create({ customerId: 'cust-1', pointsToRedeem: 10 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows redemption when balance meets minRedeemablePoints exactly', async () => {
      loyaltyService.getConfig.mockResolvedValue({
        ...cashOnlyConfig,
        minRedeemablePoints: 100,
      });
      mockBalance(100);
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await expect(
        service.create({ customerId: 'cust-1', pointsToRedeem: 100 }),
      ).resolves.toBeDefined();
    });

    it('rejects a cash redemption for more points than the balance holds', async () => {
      loyaltyService.getConfig.mockResolvedValue(cashOnlyConfig);
      mockBalance(50);

      await expect(
        service.create({ customerId: 'cust-1', pointsToRedeem: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('re-checks balance inside the transaction and rejects a race (409)', async () => {
      loyaltyService.getConfig.mockResolvedValue(cashOnlyConfig);
      // Pre-check sees enough points...
      loyaltyService.getBalance.mockResolvedValue(500);
      // ...but by the time the transaction runs, a concurrent redemption
      // already spent them.
      tx.loyaltyTransaction.aggregate.mockResolvedValue({
        _sum: { pointsDelta: 10 },
      });

      await expect(
        service.create({ customerId: 'cust-1', pointsToRedeem: 100 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('gift branch', () => {
    it('404s on an unknown giftItemId', async () => {
      loyaltyService.getConfig.mockResolvedValue(giftOnlyConfig);
      giftCatalogService.findOne.mockRejectedValue(
        new NotFoundException('Gift catalog item nope not found'),
      );
      mockBalance(500);

      await expect(
        service.create({ customerId: 'cust-1', giftItemId: 'nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a retired (inactive) gift', async () => {
      loyaltyService.getConfig.mockResolvedValue(giftOnlyConfig);
      giftCatalogService.findOne.mockResolvedValue({
        ...gift,
        activeFlag: false,
      });
      mockBalance(500);

      await expect(
        service.create({ customerId: 'cust-1', giftItemId: 'gift-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an out-of-stock gift', async () => {
      loyaltyService.getConfig.mockResolvedValue(giftOnlyConfig);
      giftCatalogService.findOne.mockResolvedValue({
        ...gift,
        stockQuantity: 0,
      });
      mockBalance(500);

      await expect(
        service.create({ customerId: 'cust-1', giftItemId: 'gift-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('decrements tracked stock atomically on success', async () => {
      loyaltyService.getConfig.mockResolvedValue(giftOnlyConfig);
      giftCatalogService.findOne.mockResolvedValue(gift); // stockQuantity: 5
      mockBalance(500);
      tx.giftCatalogItem.updateMany.mockResolvedValue({ count: 1 });
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await service.create({ customerId: 'cust-1', giftItemId: 'gift-1' });

      expect(tx.giftCatalogItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'gift-1', stockQuantity: { gt: 0 } },
        data: { stockQuantity: { decrement: 1 } },
      });
    });

    it('never touches stock for an untracked gift (stockQuantity: null)', async () => {
      loyaltyService.getConfig.mockResolvedValue(giftOnlyConfig);
      giftCatalogService.findOne.mockResolvedValue({
        ...gift,
        stockQuantity: null,
      });
      mockBalance(500);
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await service.create({ customerId: 'cust-1', giftItemId: 'gift-1' });

      expect(tx.giftCatalogItem.updateMany).not.toHaveBeenCalled();
      expect(tx.redemptionTransaction.create).toHaveBeenCalled();
    });

    it('409s when the stock updateMany races to zero rows affected', async () => {
      loyaltyService.getConfig.mockResolvedValue(giftOnlyConfig);
      giftCatalogService.findOne.mockResolvedValue(gift);
      mockBalance(500);
      tx.giftCatalogItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.create({ customerId: 'cust-1', giftItemId: 'gift-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.redemptionTransaction.create).not.toHaveBeenCalled();
    });

    it('ignores a client-supplied point amount — pointsSpent is fixed by the catalog', async () => {
      loyaltyService.getConfig.mockResolvedValue(giftOnlyConfig);
      giftCatalogService.findOne.mockResolvedValue(gift); // pointsRequired: 100
      mockBalance(500);
      tx.giftCatalogItem.updateMany.mockResolvedValue({ count: 1 });
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await service.create({
        customerId: 'cust-1',
        giftItemId: 'gift-1',
        pointsToRedeem: 1, // must be ignored on the GIFT branch
      });

      expect(tx.redemptionTransaction.create).toHaveBeenCalledWith({
        data: containing({ pointsSpent: 100 }),
      });
    });

    it('creates a compensating negative LoyaltyTransaction (REDEEMED_GIFT)', async () => {
      loyaltyService.getConfig.mockResolvedValue(giftOnlyConfig);
      giftCatalogService.findOne.mockResolvedValue(gift);
      mockBalance(500);
      tx.giftCatalogItem.updateMany.mockResolvedValue({ count: 1 });
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await service.create({ customerId: 'cust-1', giftItemId: 'gift-1' });

      expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith({
        data: {
          customerId: 'cust-1',
          billId: null,
          pointsDelta: -100,
          reason: 'REDEEMED_GIFT',
        },
      });
    });
  });

  describe('cash branch', () => {
    it('computes cashValue as pointsToRedeem × cashRedemptionRatio', async () => {
      loyaltyService.getConfig.mockResolvedValue({
        ...cashOnlyConfig,
        cashRedemptionRatio: 0.5,
      });
      mockBalance(500);
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await service.create({ customerId: 'cust-1', pointsToRedeem: 200 });

      expect(tx.redemptionTransaction.create).toHaveBeenCalledWith({
        data: containing({ cashValue: 100, pointsSpent: 200 }),
      });
    });

    it('409s when cashRedemptionRatio is not configured', async () => {
      loyaltyService.getConfig.mockResolvedValue({
        ...cashOnlyConfig,
        cashRedemptionRatio: null,
      });
      mockBalance(500);

      await expect(
        service.create({ customerId: 'cust-1', pointsToRedeem: 100 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a compensating negative LoyaltyTransaction (REDEEMED_CASH)', async () => {
      loyaltyService.getConfig.mockResolvedValue(cashOnlyConfig);
      mockBalance(500);
      tx.redemptionTransaction.create.mockResolvedValue({ id: 'rt-1' });

      await service.create({ customerId: 'cust-1', pointsToRedeem: 100 });

      expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith({
        data: {
          customerId: 'cust-1',
          billId: null,
          pointsDelta: -100,
          reason: 'REDEEMED_CASH',
        },
      });
    });

    it('requires pointsToRedeem for a CASH redemption', async () => {
      loyaltyService.getConfig.mockResolvedValue(cashOnlyConfig);
      mockBalance(500);

      await expect(
        service.create({ customerId: 'cust-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
