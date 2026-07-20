import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EarningBasis } from '@prisma/client';
import { LoyaltyService } from './loyalty.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 6.2 points formula — rule-heavy money/points logic (CLAUDE.md:
// write tests for loyalty point calculation). Covers: rupee basis, litre
// basis, override precedence (including 0-as-a-real-override), no config
// set, zero amounts, rounding, and the billId input path.
describe('LoyaltyService', () => {
  let service: LoyaltyService;
  let prisma: {
    loyaltyConfig: { findUnique: jest.Mock; upsert: jest.Mock };
    customer: { findUnique: jest.Mock };
    bill: { findUnique: jest.Mock };
    loyaltyTransaction: { aggregate: jest.Mock };
    redemptionTransaction: { findMany: jest.Mock };
  };

  const rupeeConfig = {
    id: 'singleton',
    earningBasis: EarningBasis.RUPEE,
    defaultRate: 2,
  };
  const litreConfig = {
    id: 'singleton',
    earningBasis: EarningBasis.LITRE,
    defaultRate: 0.5,
  };

  beforeEach(async () => {
    prisma = {
      loyaltyConfig: { findUnique: jest.fn(), upsert: jest.fn() },
      customer: { findUnique: jest.fn() },
      bill: { findUnique: jest.fn() },
      loyaltyTransaction: { aggregate: jest.fn() },
      redemptionTransaction: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoyaltyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(LoyaltyService);
  });

  describe('rupee basis', () => {
    it('points = (amount / 100) × rate, litres ignored', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);

      const result = await service.calculatePoints({
        amount: 1000,
        litres: 999, // must not affect a RUPEE-basis calculation
      });

      expect(result.points).toBe(20); // (1000 / 100) × 2
      expect(result.basis).toBe(EarningBasis.RUPEE);
      expect(result.rate).toBe(2);
      expect(result.rateSource).toBe('DEALER_DEFAULT');
    });

    it('zero amount earns zero points (not an error)', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);

      const result = await service.calculatePoints({ amount: 0, litres: 0 });

      expect(result.points).toBe(0);
    });

    it('preserves full IEEE754 precision — no rounding at calculation time', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue({
        ...rupeeConfig,
        defaultRate: 1.5,
      });

      // (999.99 / 100) × 1.5 = 14.99985 (exact in this case, but the point is
      // this function must never round it). Rounding is a presentation-layer
      // concern for whatever UI displays this to a human — the
      // calculated/stored value must keep full precision (Section 6.3).
      const result = await service.calculatePoints({
        amount: 999.99,
        litres: 10,
      });

      expect(result.points).toBe((999.99 / 100) * 1.5);
      expect(result.points).toBe(14.99985);
    });
  });

  describe('litre basis', () => {
    it('points = litres × rate, amount ignored', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(litreConfig);

      const result = await service.calculatePoints({
        amount: 99999, // must not affect a LITRE-basis calculation
        litres: 20,
      });

      expect(result.points).toBe(10); // 20 × 0.5
      expect(result.basis).toBe(EarningBasis.LITRE);
      expect(result.rateSource).toBe('DEALER_DEFAULT');
    });

    it('zero litres earns zero points', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(litreConfig);

      const result = await service.calculatePoints({ amount: 500, litres: 0 });

      expect(result.points).toBe(0);
    });
  });

  describe('rate precedence (Section 6.2)', () => {
    it('customer override beats the dealer default', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        loyaltyRateOverride: 5,
      });

      const result = await service.calculatePoints({
        amount: 1000,
        litres: 10,
        customerId: 'cust-1',
      });

      expect(result.rate).toBe(5);
      expect(result.rateSource).toBe('CUSTOMER_OVERRIDE');
      expect(result.points).toBe(50); // (1000 / 100) × 5, not × 2
    });

    it('override of 0 is a real override ("earns nothing"), not "unset"', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        loyaltyRateOverride: 0,
      });

      const result = await service.calculatePoints({
        amount: 1000,
        litres: 10,
        customerId: 'cust-1',
      });

      expect(result.rate).toBe(0);
      expect(result.rateSource).toBe('CUSTOMER_OVERRIDE');
      expect(result.points).toBe(0);
    });

    it('null override falls through to the dealer default', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        loyaltyRateOverride: null,
      });

      const result = await service.calculatePoints({
        amount: 1000,
        litres: 10,
        customerId: 'cust-1',
      });

      expect(result.rate).toBe(2);
      expect(result.rateSource).toBe('DEALER_DEFAULT');
      expect(result.points).toBe(20);
    });

    it('the override changes the rate, never the basis', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(litreConfig);
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        loyaltyRateOverride: 3,
      });

      const result = await service.calculatePoints({
        amount: 1000,
        litres: 20,
        customerId: 'cust-1',
      });

      expect(result.basis).toBe(EarningBasis.LITRE);
      expect(result.points).toBe(60); // 20 L × 3 — not (1000/100) × 3
    });

    it('unknown customerId is a 404, not a silent default-rate fallback', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.calculatePoints({
          amount: 100,
          litres: 1,
          customerId: 'nope',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('no config set (Section 17 — no hardcoded default)', () => {
    it('refuses with 409 instead of inventing a rate/basis', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(null);

      await expect(
        service.calculatePoints({ amount: 1000, litres: 10 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses even when the customer has an override (basis is unknowable)', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        loyaltyRateOverride: 5,
      });

      await expect(
        service.calculatePoints({
          amount: 1000,
          litres: 10,
          customerId: 'cust-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('billId input path', () => {
    it("uses the bill's amount/litres/customerId", async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);
      prisma.bill.findUnique.mockResolvedValue({
        id: 'bill-1',
        customerId: 'cust-1',
        amount: 2500,
        litres: 25,
        deletedAt: null,
      });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        loyaltyRateOverride: null,
      });

      const result = await service.calculatePoints({ billId: 'bill-1' });

      expect(result.billId).toBe('bill-1');
      expect(result.customerId).toBe('cust-1');
      expect(result.points).toBe(50); // (2500 / 100) × 2
    });

    it('soft-deleted bill is a 404', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);
      prisma.bill.findUnique.mockResolvedValue({
        id: 'bill-1',
        customerId: null,
        amount: 100,
        litres: 1,
        deletedAt: new Date(),
      });

      await expect(
        service.calculatePoints({ billId: 'bill-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('unknown bill is a 404', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);

      await expect(
        service.calculatePoints({ billId: 'nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects billId mixed with explicit amount/litres/customerId', async () => {
      await expect(
        service.calculatePoints({ billId: 'bill-1', amount: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.calculatePoints({ billId: 'bill-1', customerId: 'cust-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a customer-less walk-in bill uses the dealer default', async () => {
      prisma.loyaltyConfig.findUnique.mockResolvedValue(rupeeConfig);
      prisma.bill.findUnique.mockResolvedValue({
        id: 'bill-1',
        customerId: null,
        amount: 300,
        litres: 3,
        deletedAt: null,
      });

      const result = await service.calculatePoints({ billId: 'bill-1' });

      expect(result.rateSource).toBe('DEALER_DEFAULT');
      expect(result.points).toBe(6);
      expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    });
  });

  // Pulled up out of RedemptionsService (was a private duplicate there) so
  // there's exactly one place that computes a customer's points balance —
  // see this method's own comment in loyalty.service.ts. Used by
  // RedemptionsService and CustomerPortalService.
  describe('getBalance', () => {
    it('sums LoyaltyTransaction.pointsDelta for the customer', async () => {
      prisma.loyaltyTransaction.aggregate.mockResolvedValue({
        _sum: { pointsDelta: 175 },
      });

      const result = await service.getBalance('cust-1');

      expect(prisma.loyaltyTransaction.aggregate).toHaveBeenCalledWith({
        where: { customerId: 'cust-1' },
        _sum: { pointsDelta: true },
      });
      expect(result).toBe(175);
    });

    it('returns 0 when the customer has no loyalty transactions at all', async () => {
      prisma.loyaltyTransaction.aggregate.mockResolvedValue({
        _sum: { pointsDelta: null },
      });

      const result = await service.getBalance('cust-1');

      expect(result).toBe(0);
    });
  });

  // Section 12 — Loyalty Program Cost Report ("a real liability, track it
  // like one"). Rule-heavy money/points logic (CLAUDE.md: write tests for
  // this category) — covers issued-vs-redeemed netting, the cash/gift
  // redemption split, and the outstanding-liability valuation judgment call
  // (points-only when no cashRedemptionRatio is configured).
  describe('getCostReport', () => {
    it('nets issued (positive deltas) against redeemed (negative deltas)', async () => {
      prisma.loyaltyTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { pointsDelta: 1000 } }) // issued (>0 filter)
        .mockResolvedValueOnce({ _sum: { pointsDelta: -300 } }); // redeemed (<0 filter)
      prisma.redemptionTransaction.findMany.mockResolvedValue([]);
      prisma.loyaltyConfig.findUnique.mockResolvedValue(null);

      const result = await service.getCostReport();

      expect(result.pointsIssued).toBe(1000);
      expect(result.pointsRedeemed).toBe(300); // sign flipped to positive
      expect(result.pointsOutstanding).toBe(700);
    });

    it('splits redemptions into cash vs. gift buckets', async () => {
      prisma.loyaltyTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { pointsDelta: 1000 } })
        .mockResolvedValueOnce({ _sum: { pointsDelta: -500 } });
      prisma.redemptionTransaction.findMany.mockResolvedValue([
        { redemptionType: 'CASH', pointsSpent: 200, cashValue: 20 },
        { redemptionType: 'CASH', pointsSpent: 100, cashValue: 10 },
        { redemptionType: 'GIFT', pointsSpent: 200, cashValue: null },
      ]);
      prisma.loyaltyConfig.findUnique.mockResolvedValue(null);

      const result = await service.getCostReport();

      expect(result.redemptionBreakdown.cash).toEqual({
        redemptionCount: 2,
        pointsRedeemed: 300,
        cashValuePaidOut: 30,
      });
      expect(result.redemptionBreakdown.gift).toEqual({
        redemptionCount: 1,
        pointsRedeemed: 200,
      });
    });

    it('values the outstanding liability at cashRedemptionRatio when configured', async () => {
      prisma.loyaltyTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { pointsDelta: 1000 } })
        .mockResolvedValueOnce({ _sum: { pointsDelta: -400 } });
      prisma.redemptionTransaction.findMany.mockResolvedValue([]);
      prisma.loyaltyConfig.findUnique.mockResolvedValue({
        id: 'singleton',
        cashRedemptionRatio: 0.1, // 1 point = 0.1 rupee
      });

      const result = await service.getCostReport();

      expect(result.pointsOutstanding).toBe(600);
      expect(result.cashRedemptionRatio).toBe(0.1);
      expect(result.outstandingLiabilityValue).toBe(60); // 600 × 0.1
    });

    it('returns null liability value (not a fabricated rate) when no ratio is configured', async () => {
      prisma.loyaltyTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { pointsDelta: 500 } })
        .mockResolvedValueOnce({ _sum: { pointsDelta: null } });
      prisma.redemptionTransaction.findMany.mockResolvedValue([]);
      prisma.loyaltyConfig.findUnique.mockResolvedValue(null);

      const result = await service.getCostReport();

      expect(result.cashRedemptionRatio).toBeNull();
      expect(result.outstandingLiabilityValue).toBeNull();
    });

    it('handles zero issued/redeemed (no loyalty activity yet) without error', async () => {
      prisma.loyaltyTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { pointsDelta: null } })
        .mockResolvedValueOnce({ _sum: { pointsDelta: null } });
      prisma.redemptionTransaction.findMany.mockResolvedValue([]);
      prisma.loyaltyConfig.findUnique.mockResolvedValue(null);

      const result = await service.getCostReport();

      expect(result.pointsIssued).toBe(0);
      expect(result.pointsRedeemed).toBe(0);
      expect(result.pointsOutstanding).toBe(0);
    });
  });
});
