import { Module } from '@nestjs/common';
import { RedemptionsController } from './redemptions.controller';
import { RedemptionsService } from './redemptions.service';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { GiftCatalogModule } from '../gift-catalog/gift-catalog.module';

// Section 6.4/6.6 — counter redemption. LoyaltyModule imported for
// LoyaltyService (config lookup); GiftCatalogModule imported for
// GiftCatalogService (gift lookup for GIFT redemptions) so this module
// doesn't duplicate GiftCatalogItem query/404 logic.
// RedemptionsService is exported so CustomerPortalModule can delegate
// POST /customer-portal/redemptions to the exact same money/points logic
// (balance checks, stock decrement, transaction) instead of reimplementing
// any of it — see CustomerPortalService.createRedemption().
@Module({
  imports: [LoyaltyModule, GiftCatalogModule],
  controllers: [RedemptionsController],
  providers: [RedemptionsService],
  exports: [RedemptionsService],
})
export class RedemptionsModule {}
