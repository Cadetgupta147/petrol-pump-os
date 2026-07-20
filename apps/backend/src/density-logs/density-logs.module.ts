import { Module } from '@nestjs/common';
import { DensityLogsController } from './density-logs.controller';
import { DensityLogsService } from './density-logs.service';

// Section 7.3 — density/quality check. PrismaModule is global (see
// prisma.module.ts), so no imports needed. DensityLogsService is exported
// so PurchasesModule and TanksModule can import it if they need the
// computeDensityFlag()/service surface beyond what they already do (both
// currently create linked DensityLog rows directly inside their own
// transaction — see purchases.service.ts / tanks.service.ts — but importing
// this module keeps the dependency graph explicit and matches
// TanksModule/CreditConfigModule's export convention).
@Module({
  controllers: [DensityLogsController],
  providers: [DensityLogsService],
  exports: [DensityLogsService],
})
export class DensityLogsModule {}
