import { Module } from '@nestjs/common';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { OcrModule } from '../ocr/ocr.module';
import { DensityLogsModule } from '../density-logs/density-logs.module';

// Section 7.1/7.2 — manual purchase entry. PrismaModule is global (see
// prisma.module.ts), so no imports needed.
// Section 9 — OcrModule feeds the ocr-extract pre-fill endpoint on
// PurchasesController; it never touches the create() flow above.
// Section 7.3 — DensityLogsModule imported for the dependency-graph
// documentation (PurchasesService.create() calls the standalone
// computeDensityFlag() pure function + this.prisma.densityLog.create()
// directly inside its existing array-form transaction, not
// DensityLogsService via DI — see that method's comment).
@Module({
  imports: [OcrModule, DensityLogsModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}
