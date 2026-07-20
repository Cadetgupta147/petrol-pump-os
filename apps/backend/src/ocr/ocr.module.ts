import { Module } from '@nestjs/common';
import { OcrService } from './ocr.service';

// Section 9 — Google Cloud Vision DOCUMENT_TEXT_DETECTION for supplier
// invoice OCR. ConfigModule is global (see app.module.ts), so no explicit
// import needed for ConfigService.
@Module({
  providers: [OcrService],
  exports: [OcrService],
})
export class OcrModule {}
