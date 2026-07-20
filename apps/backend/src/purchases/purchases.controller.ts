import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseEntryDto } from './dto/create-purchase-entry.dto';
import { OcrService } from '../ocr/ocr.service';

const MAX_INVOICE_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

// Section 7.1/7.2 — manual purchase entry (tanker delivery -> tank level
// increases). Owner/Accountant only — procurement/accounting task, not a
// DSM task. See purchases.service.ts for the hard-block-on-missing-Tank
// behavior and its documented asymmetry with MeterReadingsService's
// closeShift() soft-warning.
//
// Section 9 — POST /purchase-entries/ocr-extract lives on this same
// controller (same Owner/Accountant scope) since it exists only to feed
// this form. It never creates a PurchaseEntry or touches Tank stock — it
// only returns pre-fill data for a human to review before calling the
// unmodified POST /purchase-entries above.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('purchase-entries')
export class PurchasesController {
  constructor(
    private readonly purchasesService: PurchasesService,
    private readonly ocrService: OcrService,
  ) {}

  @Post()
  create(@Body() dto: CreatePurchaseEntryDto) {
    return this.purchasesService.create(dto);
  }

  @Get()
  findAll() {
    return this.purchasesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchasesService.findOne(id);
  }

  // Memory storage only — nothing here persists the uploaded image to disk
  // or a bucket (file storage is a separate, still-open item; see
  // CLAUDE.md / .env.example STORAGE_* vars). The image lives only for the
  // duration of this request, sent to Vision and then discarded.
  @Post('ocr-extract')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_INVOICE_IMAGE_BYTES },
    }),
  )
  async ocrExtract(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'No file uploaded — attach an invoice image under the "file" field',
      );
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException(
        `Unsupported file type "${file.mimetype}" — upload an image (JPEG/PNG/etc.) of the invoice`,
      );
    }

    return this.ocrService.extractInvoiceFields(file.buffer);
  }
}
