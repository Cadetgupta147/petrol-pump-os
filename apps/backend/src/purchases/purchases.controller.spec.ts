import { BadRequestException } from '@nestjs/common';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { OcrService } from '../ocr/ocr.service';

// Section 9 — controller-level guards on POST /purchase-entries/ocr-extract.
// Oversized-upload rejection (413) is handled upstream by
// @nestjs/platform-express's FileInterceptor + multer limits (see
// purchases.controller.ts's MAX_INVOICE_IMAGE_BYTES) and isn't re-tested
// here — this covers the controller's own explicit checks: missing file and
// non-image content type.
describe('PurchasesController#ocrExtract', () => {
  let controller: PurchasesController;
  let ocrService: { extractInvoiceFields: jest.Mock };

  beforeEach(() => {
    ocrService = { extractInvoiceFields: jest.fn() };
    controller = new PurchasesController(
      {} as PurchasesService,
      ocrService as unknown as OcrService,
    );
  });

  it('rejects with a 400 when no file is uploaded', async () => {
    await expect(controller.ocrExtract(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ocrService.extractInvoiceFields).not.toHaveBeenCalled();
  });

  it('rejects a non-image upload with a clear 400', async () => {
    const file = {
      mimetype: 'application/pdf',
      buffer: Buffer.from('not-an-image'),
    } as Express.Multer.File;

    await expect(controller.ocrExtract(file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ocrService.extractInvoiceFields).not.toHaveBeenCalled();
  });

  it('delegates to OcrService for a valid image upload', async () => {
    const file = {
      mimetype: 'image/jpeg',
      buffer: Buffer.from('fake-jpeg-bytes'),
    } as Express.Multer.File;
    const expected = { extractedFields: {}, rawText: 'text' };
    ocrService.extractInvoiceFields.mockResolvedValue(expected);

    const result = await controller.ocrExtract(file);

    expect(ocrService.extractInvoiceFields).toHaveBeenCalledWith(file.buffer);
    expect(result).toBe(expected);
  });
});
