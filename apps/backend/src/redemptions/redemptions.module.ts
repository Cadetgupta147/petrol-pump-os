import { Module } from '@nestjs/common';
import { RedemptionsController } from './redemptions.controller';
import { RedemptionsService } from './redemptions.service';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { GiftCatalogModule } from '../gift-catalog/gift-catalog.module';

// Section 6.4/6.6 — counter redemption. LoyaltyModule imported for
// LoyaltyService (config lookup); GiftCatalogModule imported for
// GiftCatalogService (gift lookup for GIFT redemptions) so this module
// doesn't duplicate GiftCatalogItem query/404 logic.
@Module({
  imports: [LoyaltyModule, GiftCatalogModule],
  controllers: [RedemptionsController],
  providers: [RedemptionsService],
})
export class RedemptionsModule {}
