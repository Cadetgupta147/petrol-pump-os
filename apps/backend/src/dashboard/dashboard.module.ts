import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// PrismaService comes from the global PrismaModule (see prisma.module.ts) —
// no explicit import needed here, same pattern as BillsModule/
// MeterReadingsModule.
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
