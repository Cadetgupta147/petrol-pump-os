import { Module } from '@nestjs/common';
import { TallyExportController } from './tally-export.controller';
import { TallyExportService } from './tally-export.service';

// PrismaService comes from the global PrismaModule (see prisma.module.ts),
// ConfigService from the global ConfigModule (see app.module.ts) — no
// explicit imports needed here, same pattern as DashboardModule.
@Module({
  controllers: [TallyExportController],
  providers: [TallyExportService],
})
export class TallyExportModule {}
