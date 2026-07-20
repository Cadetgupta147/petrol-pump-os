import { Test, TestingModule } from '@nestjs/testing';
import { RedemptionType } from '@prisma/client';
import { CustomerPortalService } from './customer-portal.service';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GiftCatalogService } from '../gift-catalog/gift-catalog.service';
import { RedemptionsService } from '../redemptions/redemptions.service';

// Section 5/6 — the Credit Customer App's data surface. This service is
// deliberately a thin composition layer over already-reviewed money/points
// services (CustomersService.ledger, LoyaltyService.getBalance/getConfig,
// GiftCatalogService.findAll, RedemptionsService.create); these tests cover
// the composition/derivation logic that lives here, not a re-test of the
// underlying business rules (which have their own unit coverage elsewhere).
describe('CustomerPortalService', () => {
  let service: CustomerPortalService;
  let prisma: { bill: { findMany: jest.Mock } };
  let customersService: { ledger: jest.Mock };
  let loyaltyService: { getBalance: jest.Mock; getConfig: jest.Mock };
  let giftCatalogService: { findAll: jest.Mock };
  let redemptionsService: { create: jest.Mock };

  const baseLedger = {
    customer: {
      id: 'cust-1',
      name: 'Asha Transport',
      phone: '9990000001',
      vehicleNumber: 'KA01AB1234',
      qrMemberId: 'PUMP001-CUST-00001-8',
      verificationStatus: 'VERIFIED',
      // Fields that must NOT leak into the /me response — pointer-not-wallet
      // (Section 6.1/6.2): no earningBasis/defaultRate is even present here
      // to leak, but creditLimit/loyaltyRateOverride/tokenVersion ARE present
      // on the real Customer row ledger() returns, and must be excluded.
      creditLimit: 5000,
      loyaltyRateOverride: 3,
      tokenVersion: 0,
    },
    entries: [],
    outstandingBalance: 250,
    creditLimit: 5000,
  };

  beforeEach(async () => {
    prisma = { bill: { findMany: jest.fn() } };
    customersService = { ledger: jest.fn() };
    loyaltyService = { getBalance: jest.fn(), getConfig: jest.fn() };
    giftCatalogService = { findAll: jest.fn() };
    redemptionsService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerPortalService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomersService, useValue: customersService },
        { provide: LoyaltyService, useValue: loyaltyService },
        { provide: GiftCatalogService, useValue: giftCatalogService },
        { provide: RedemptionsService, useValue: redemptionsService },
      ],
    }).compile();

    service = module.get(CustomerPortalService);
  });

  describe('getMe', () => {
    it('returns redemption: null when loyalty is not configured at all', async () => {
      customersService.ledger.mockResolvedValue(baseLedger);
      loyaltyService.getBalance.mockResolvedValue(120);
      loyaltyService.getConfig.mockResolvedValue(null);

      const result = await service.getMe('cust-1');

      expect(result.redemption).toBeNull();
      expect(result.pointsBalance).toBe(120);
      expect(result.outstandingBalance).toBe(250);
    });

    it('returns redemption: null when config exists but redemptionTypeAllowed is unset', async () => {
      customersService.ledger.mockResolvedValue(baseLedger);
      loyaltyService.getBalance.mockResolvedValue(120);
      loyaltyService.getConfig.mockResolvedValue({
        id: 'singleton',
        earningBasis: 'RUPEE',
        defaultRate: 2,
        redemptionTypeAllowed: null,
        customerCanChooseRedemption: false,
        defaultRedemptionMode: null,
        cashRedemptionRatio: null,
        minRedeemablePoints: null,
      });

      const result = await service.getMe('cust-1');

      expect(result.redemption).toBeNull();
    });

    it('populates redemption when configured, without leaking earningBasis/defaultRate', async () => {
      customersService.ledger.mockResolvedValue(baseLedger);
      loyaltyService.getBalance.mockResolvedValue(120);
      loyaltyService.getConfig.mockResolvedValue({
        id: 'singleton',
        earningBasis: 'RUPEE',
        defaultRate: 2, // must never appear in the response
        redemptionTypeAllowed: RedemptionType.BOTH,
        customerCanChooseRedemption: true,
        defaultRedemptionMode: null,
        cashRedemptionRatio: 0.5,
        minRedeemablePoints: 100,
      });

      const result = await service.getMe('cust-1');

      expect(result.redemption).toEqual({
        typeAllowed: RedemptionType.BOTH,
        customerCanChoose: true,
        cashRedemptionRatio: 0.5,
        minRedeemablePoints: 100,
      });
      expect(result).not.toHaveProperty('earningBasis');
      expect(result).not.toHaveProperty('defaultRate');
    });

    it('never leaks creditLimit, loyaltyRateOverride, or tokenVersion from the underlying customer row', async () => {
      customersService.ledger.mockResolvedValue(baseLedger);
      loyaltyService.getBalance.mockResolvedValue(0);
      loyaltyService.getConfig.mockResolvedValue(null);

      const result = await service.getMe('cust-1');

      expect(result).not.toHaveProperty('creditLimit');
      expect(result).not.toHaveProperty('loyaltyRateOverride');
      expect(result).not.toHaveProperty('tokenVersion');
    });

    it('derives outstandingBalance from CustomersService.ledger() — the one shared source', async () => {
      customersService.ledger.mockResolvedValue({
        ...baseLedger,
        outstandingBalance: -75, // customer is in credit / overpaid
      });
      loyaltyService.getBalance.mockResolvedValue(0);
      loyaltyService.getConfig.mockResolvedValue(null);

      const result = await service.getMe('cust-1');

      expect(customersService.ledger).toHaveBeenCalledWith('cust-1');
      expect(result.outstandingBalance).toBe(-75);
    });
  });

  describe('getBills', () => {
    it('queries by customerId, excludes soft-deleted bills, orders newest-first, and applies the default limit', async () => {
      prisma.bill.findMany.mockResolvedValue([]);

      await service.getBills('cust-1', undefined);

      expect(prisma.bill.findMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', deletedAt: null },
        orderBy: { timestamp: 'desc' },
        take: 20,
        select: {
          id: true,
          timestamp: true,
          amount: true,
          litres: true,
          productType: true,
          loyaltyPointsEarned: true,
          loyaltyBasisUsed: true,
        },
      });
    });

    it('respects an explicit limit', async () => {
      prisma.bill.findMany.mockResolvedValue([]);

      await service.getBills('cust-1', 5);

      expect(prisma.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it('caps the limit at 100 even if a larger value slips through', async () => {
      prisma.bill.findMany.mockResolvedValue([]);

      await service.getBills('cust-1', 500);

      expect(prisma.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('getGiftCatalog', () => {
    const makeGift = (overrides: Record<string, unknown>) => ({
      id: 'gift-1',
      giftName: 'Travel Mug',
      imageUrl: null,
      pointsRequired: 100,
      stockQuantity: 5,
      activeFlag: true,
      ...overrides,
    });

    it('excludes retired (activeFlag: false) gifts entirely', async () => {
      giftCatalogService.findAll.mockResolvedValue([
        makeGift({ id: 'active-gift', activeFlag: true }),
        makeGift({ id: 'retired-gift', activeFlag: false }),
      ]);
      loyaltyService.getBalance.mockResolvedValue(1000);

      const result = await service.getGiftCatalog('cust-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('active-gift');
    });

    it('marks a tracked, in-stock, affordable gift correctly', async () => {
      giftCatalogService.findAll.mockResolvedValue([
        makeGift({ stockQuantity: 5, pointsRequired: 100 }),
      ]);
      loyaltyService.getBalance.mockResolvedValue(150);

      const [result] = await service.getGiftCatalog('cust-1');

      expect(result).toMatchObject({
        inStock: true,
        affordable: true,
        pointsShort: 0,
      });
    });

    it('marks a tracked, out-of-stock gift as not in stock and not affordable regardless of balance', async () => {
      giftCatalogService.findAll.mockResolvedValue([
        makeGift({ stockQuantity: 0, pointsRequired: 50 }),
      ]);
      loyaltyService.getBalance.mockResolvedValue(10000);

      const [result] = await service.getGiftCatalog('cust-1');

      expect(result).toMatchObject({ inStock: false, affordable: false });
    });

    it('treats untracked stock (stockQuantity: null) as always in stock', async () => {
      giftCatalogService.findAll.mockResolvedValue([
        makeGift({ stockQuantity: null, pointsRequired: 100 }),
      ]);
      loyaltyService.getBalance.mockResolvedValue(50); // not enough points, but stock is untracked

      const [result] = await service.getGiftCatalog('cust-1');

      expect(result.inStock).toBe(true);
      expect(result.affordable).toBe(false); // insufficient points still blocks affordability
      expect(result.pointsShort).toBe(50);
    });

    it('computes pointsShort as max(0, pointsRequired - balance), never negative', async () => {
      giftCatalogService.findAll.mockResolvedValue([
        makeGift({ pointsRequired: 100 }),
      ]);
      loyaltyService.getBalance.mockResolvedValue(500); // well above requirement

      const [result] = await service.getGiftCatalog('cust-1');

      expect(result.pointsShort).toBe(0);
    });
  });

  describe('createRedemption', () => {
    it('composes CreateRedemptionDto with the passed-in customerId, delegating entirely to RedemptionsService.create', async () => {
      redemptionsService.create.mockResolvedValue({ id: 'redemption-1' });

      await service.createRedemption('cust-1', {
        redemptionType: RedemptionType.CASH,
        pointsToRedeem: 50,
      });

      expect(redemptionsService.create).toHaveBeenCalledWith({
        customerId: 'cust-1',
        redemptionType: RedemptionType.CASH,
        giftItemId: undefined,
        pointsToRedeem: 50,
      });
    });

    it('always uses the passed-in customerId, never anything from the dto shape', async () => {
      redemptionsService.create.mockResolvedValue({ id: 'redemption-1' });

      // CreateCustomerRedemptionDto has no customerId field at the type
      // level; simulate a caller trying to smuggle one in anyway via an
      // unsafe cast, and confirm the service still only ever uses the
      // explicit customerId argument.
      const dtoWithSmuggledId = {
        customerId: 'someone-elses-id',
        pointsToRedeem: 10,
      } as unknown as Parameters<typeof service.createRedemption>[1];

      await service.createRedemption('cust-1', dtoWithSmuggledId);

      expect(redemptionsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cust-1' }),
      );
    });
  });
});
