import { Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyConfigController } from './loyalty-config.controller';
import { LoyaltyController } from './loyalty.controller';

// Section 6.2 — loyalty earning config + points calculation.
// PrismaModule is global (see prisma.module.ts), so no imports needed.
// LoyaltyService is exported so the bills module can reuse the exact same
// calculation when points-crediting-on-bill-save (Section 6.3) is built.
@Module({
  controllers: [LoyaltyConfigController, LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
