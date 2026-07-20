import { Module } from '@nestjs/common';
import { TanksController } from './tanks.controller';
import { TanksService } from './tanks.service';

// Section 7.1/7.2 — Tank CRUD, DIP readings, variance report. PrismaModule is
// global (see prisma.module.ts), so no imports needed. TanksService is
// exported so PurchasesModule can reuse it if it ever needs Tank lookups
// beyond a raw Prisma query (currently it queries Prisma directly — see
// purchases.service.ts comment).
@Module({
  controllers: [TanksController],
  providers: [TanksService],
  exports: [TanksService],
})
export class TanksModule {}
