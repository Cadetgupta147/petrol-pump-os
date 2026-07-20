import { Module } from '@nestjs/common';
import { RateMasterController } from './rate-master.controller';
import { RateMasterService } from './rate-master.service';

// Section 7.4 — Rate Master. PrismaModule is global (see prisma.module.ts),
// so no imports needed. RateMasterService is exported so BillsModule can
// import it directly (same pattern as CreditConfigModule/LoyaltyModule being
// imported into BillsModule — see bills.module.ts) to resolve
// Bill.rateApplied authoritatively at bill-creation time.
@Module({
  controllers: [RateMasterController],
  providers: [RateMasterService],
  exports: [RateMasterService],
})
export class RateMasterModule {}
