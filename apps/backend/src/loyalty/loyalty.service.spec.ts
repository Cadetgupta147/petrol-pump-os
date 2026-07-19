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
});
