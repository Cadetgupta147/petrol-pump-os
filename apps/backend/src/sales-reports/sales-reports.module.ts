import { Module } from '@nestjs/common';
import { SalesReportsController } from './sales-reports.controller';
import { SalesReportsService } from './sales-reports.service';
import { RateMasterModule } from '../rate-master/rate-master.module';

// PrismaService comes from the global PrismaModule — same pattern as
// DashboardModule. RateMasterModule is imported for the DSR's rate-at-
// shift-end lookups (Section 12B) — same cross-module reuse precedent as
// BillsModule already importing it.
@Module({
  imports: [RateMasterModule],
  controllers: [SalesReportsController],
  providers: [SalesReportsService],
})
export class SalesReportsModule {}
