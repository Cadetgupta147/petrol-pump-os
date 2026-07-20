import { Module } from '@nestjs/common';
import { TanksController } from './tanks.controller';
import { TanksService } from './tanks.service';
import { DensityLogsModule } from '../density-logs/density-logs.module';

// Section 7.1/7.2 — Tank CRUD, DIP readings, variance report. PrismaModule is
// global (see prisma.module.ts), so no imports needed. TanksService is
// exported so PurchasesModule can reuse it if it ever needs Tank lookups
// beyond a raw Prisma query (currently it queries Prisma directly — see
// purchases.service.ts comment).
//
// Section 7.3 — DensityLogsModule imported for the dependency-graph
// documentation (this module's linked DensityLog creation, inside
// recordDipReading()'s existing transaction, calls tx.densityLog.create()
// directly plus the standalone computeDensityFlag() pure function import —
// not DensityLogsService via DI — but importing the module keeps the
// relationship explicit for a future reader, same reasoning as OcrModule
// being imported into PurchasesModule).
@Module({
  imports: [DensityLogsModule],
  controllers: [TanksController],
  providers: [TanksService],
  exports: [TanksService],
})
export class TanksModule {}
