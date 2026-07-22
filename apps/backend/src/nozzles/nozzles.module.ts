import { Module } from '@nestjs/common';
import { NozzlesController } from './nozzles.controller';
import { NozzlesService } from './nozzles.service';

// Section 3.3/4 — Nozzle master CRUD. PrismaModule is global (see
// prisma.module.ts), so no imports needed. Exported so MeterReadingsModule
// could reuse it if it ever needs more than a raw Prisma lookup (currently
// MeterReadingsService queries prisma.nozzle directly for the carry-forward
// calculation — see that file's resolveOpeningReading()).
@Module({
  controllers: [NozzlesController],
  providers: [NozzlesService],
  exports: [NozzlesService],
})
export class NozzlesModule {}
