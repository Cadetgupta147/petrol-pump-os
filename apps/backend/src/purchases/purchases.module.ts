import { Module } from '@nestjs/common';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { OcrModule } from '../ocr/ocr.module';

// Section 7.1/7.2 — manual purchase entry. PrismaModule is global (see
// prisma.module.ts), so no imports needed.
// Section 9 — OcrModule feeds the ocr-extract pre-fill endpoint on
// PurchasesController; it never touches the create() flow above.
@Module({
  imports: [OcrModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}
