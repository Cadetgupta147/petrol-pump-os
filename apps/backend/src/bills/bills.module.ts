import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { CreditConfigModule } from '../credit-config/credit-config.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { RateMasterModule } from '../rate-master/rate-master.module';
import { VehicleBlacklistModule } from '../vehicle-blacklist/vehicle-blacklist.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TaxRateConfigModule } from '../tax-rate-config/tax-rate-config.module';

// CreditConfigModule imported for CreditConfigService (Section 3.4A
// enforcement mode + default informal credit limit). LoyaltyModule imported
// for LoyaltyService (Section 6.3 step 5 — points credited on bill save).
// RateMasterModule imported for RateMasterService (Section 7.4 — server-side
// resolution of Bill.rateApplied at create() time). VehicleBlacklistModule
// imported for VehicleBlacklistService (Section 3.4B — blocks a CREDIT bill
// outright when the vehicle/company/customer is on an active blacklist).
// CreditAlertsModule is NOT imported here — alert creation happens directly
// via the shared Prisma transaction client inside BillsService, not through
// CreditAlertsService. TaxRateConfigModule imported for TaxRateConfigService.
// resolveTaxRateMap() — the same dealer-configured per-productType GST rate
// (Section 17.22) the sales/purchase register already reads, now reused as
// the default taxRate for a bill's extra (non-fuel) line items too, keyed
// by BillLineItem.itemName against that same productType string.
@Module({
  imports: [
    CreditConfigModule,
    LoyaltyModule,
    RateMasterModule,
    VehicleBlacklistModule,
    LedgerModule,
    TaxRateConfigModule,
  ],
  controllers: [BillsController],
  providers: [BillsService],
})
export class BillsModule {}
