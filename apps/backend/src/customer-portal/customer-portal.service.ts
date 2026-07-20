import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GiftCatalogService } from '../gift-catalog/gift-catalog.service';
import { RedemptionsService } from '../redemptions/redemptions.service';
import { CreateCustomerRedemptionDto } from './dto/create-customer-redemption.dto';

const DEFAULT_BILLS_LIMIT = 20;

// Section 5/6 (home screen, bill history, gift catalog, redemption) — the
// Credit Customer App's own data surface, scoped entirely to a single
// customer resolved server-side from a validated customer JWT
// (CustomerPortalController never accepts a customerId from the caller).
//
// This module deliberately does NOT reimplement any money/points logic:
// - outstandingBalance reuses CustomersService.ledger() (same derivation the
//   web portal already uses — one source of truth).
// - pointsBalance reuses LoyaltyService.getBalance() (pulled up out of
//   RedemptionsService for exactly this reason).
// - POST /customer-portal/redemptions delegates to the already-reviewed
//   RedemptionsService.create() — this file only composes the DTO.
@Injectable()
export class CustomerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
    private readonly loyaltyService: LoyaltyService,
    private readonly giftCatalogService: GiftCatalogService,
    private readonly redemptionsService: RedemptionsService,
  ) {}

  // GET /customer-portal/me — profile + balance for the home screen.
  // Deliberately excludes earningBasis/defaultRate: "pointer, not wallet"
  // (Section 6.1/6.2) — the customer sees their balance and what they can do
  // with it, never the dealer's earning formula.
  async getMe(customerId: string) {
    const [ledger, pointsBalance, config] = await Promise.all([
      this.customersService.ledger(customerId),
      this.loyaltyService.getBalance(customerId),
      this.loyaltyService.getConfig(),
    ]);
    const customer = ledger.customer;

    // Mirrors the "not configured yet" handling already in
    // LoyaltyService/RedemptionsService: no config row, or a config row that
    // hasn't had redemptionTypeAllowed set, is a normal not-yet-configured
    // state for the frontend to render — not an error.
    const redemption =
      config && config.redemptionTypeAllowed
        ? {
            typeAllowed: config.redemptionTypeAllowed,
            customerCanChoose: config.customerCanChooseRedemption,
            cashRedemptionRatio: config.cashRedemptionRatio,
            minRedeemablePoints: config.minRedeemablePoints,
          }
        : null;

    return {
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      vehicleNumber: customer.vehicleNumber,
      qrMemberId: customer.qrMemberId,
      verificationStatus: customer.verificationStatus,
      pointsBalance,
      outstandingBalance: ledger.outstandingBalance,
      redemption,
    };
  }

  // GET /customer-portal/bills?limit= — Section 5's itemized bill history:
  // "date, litres, amount, points earned". Most recent first, excludes
  // soft-deleted bills — same `deletedAt: null` filter CustomersService.ledger()
  // uses. Direct query (rather than reusing ledger(), which also merges in
  // Payment rows and returns full Bill objects) since this only needs a
  // small, ordered, capped, bill-only projection.
  async getBills(customerId: string, limit: number | undefined) {
    const take = Math.min(limit ?? DEFAULT_BILLS_LIMIT, 100);

    const bills = await this.prisma.bill.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { timestamp: 'desc' },
      take,
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

    return bills;
  }

  // GET /customer-portal/gift-catalog — active gifts only, with
  // affordability computed against the customer's live balance so the app
  // can render the "locked, need X more points" state (Section 14 mockup)
  // without doing this math client-side.
  async getGiftCatalog(customerId: string) {
    const [gifts, pointsBalance] = await Promise.all([
      this.giftCatalogService.findAll(),
      this.loyaltyService.getBalance(customerId),
    ]);

    return gifts
      .filter((gift) => gift.activeFlag)
      .map((gift) => {
        const inStock = gift.stockQuantity === null || gift.stockQuantity > 0;
        const affordable = inStock && pointsBalance >= gift.pointsRequired;
        const pointsShort = Math.max(0, gift.pointsRequired - pointsBalance);

        return {
          id: gift.id,
          giftName: gift.giftName,
          imageUrl: gift.imageUrl,
          pointsRequired: gift.pointsRequired,
          stockQuantity: gift.stockQuantity,
          inStock,
          affordable,
          pointsShort,
        };
      });
  }

  // POST /customer-portal/redemptions — composes the real
  // CreateRedemptionDto by injecting customerId from the authenticated
  // request (never from the body) and delegates entirely to
  // RedemptionsService.create(): balance checks, stock decrement, and the
  // transaction all stay centralized in that already-reviewed money/points
  // code (CLAUDE.md).
  createRedemption(customerId: string, dto: CreateCustomerRedemptionDto) {
    return this.redemptionsService.create({
      customerId,
      redemptionType: dto.redemptionType,
      giftItemId: dto.giftItemId,
      pointsToRedeem: dto.pointsToRedeem,
    });
  }
}
