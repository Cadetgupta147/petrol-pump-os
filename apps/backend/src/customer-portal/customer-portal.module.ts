import { Module } from '@nestjs/common';
import { CustomerPortalController } from './customer-portal.controller';
import { CustomerPortalService } from './customer-portal.service';
import { CustomersModule } from '../customers/customers.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { GiftCatalogModule } from '../gift-catalog/gift-catalog.module';
import { RedemptionsModule } from '../redemptions/redemptions.module';

// Section 5/6 — the Credit Customer App's own data surface. Deliberately
// reuses CustomersService (ledger/outstandingBalance), LoyaltyService
// (points balance + config), GiftCatalogService (catalog reads), and
// RedemptionsService (the actual redemption transaction) rather than
// duplicating any of that money/points logic — see customer-portal.service.ts.
//
// Note: this module does NOT import CustomerAuthModule. CustomerJwtAuthGuard
// only needs the 'customer-jwt' Passport strategy to be registered
// somewhere in the process, and CustomerAuthModule (which provides
// CustomerJwtStrategy) is already imported once, globally, in app.module.ts
// — Passport strategy registration is process-wide, not per-Nest-module.
@Module({
  imports: [CustomersModule, LoyaltyModule, GiftCatalogModule, RedemptionsModule],
  controllers: [CustomerPortalController],
  providers: [CustomerPortalService],
})
export class CustomerPortalModule {}
