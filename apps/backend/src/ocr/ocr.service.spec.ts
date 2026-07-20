import { BadGatewayException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { OcrService } from './ocr.service';

// Section 9 — OcrService tests. The Vision HTTP call is mocked throughout
// (global fetch), never hitting the real API. parseInvoiceText's own
// heuristics have dedicated coverage in invoice-text-parser.util.spec.ts —
// this file only covers the service's own responsibilities: config
// validation, HTTP error handling, and the no-text-detected fallback.
describe('OcrService', () => {
  let service: OcrService;
  let config: { get: jest.Mock };
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    config = { get: jest.fn() };
    fetchMock = jest.fn();
    global.fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [OcrService, { provide: ConfigService, useValue: config }],
    }).compile();

    service = module.get(OcrService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects with a clear ConflictException (not a bare 500) when GOOGLE_CLOUD_VISION_API_KEY is not configured', async () => {
    config.get.mockReturnValue(undefined);

    await expect(
      service.extractInvoiceFields(Buffer.from('fake-image')),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns all-null extracted fields and empty rawText when Vision detects no text', async () => {
    config.get.mockReturnValue('fake-api-key');
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ responses: [{}] }),
    });

    const result = await service.extractInvoiceFields(Buffer.from('blank-image'));

    expect(result.rawText).toBe('');
    expect(result.extractedFields).toEqual({
      supplierName: null,
      productType: null,
      quantityLitres: null,
      ratePerLitre: null,
      amount: null,
      invoiceNo: null,
      tankerNo: null,
      invoiceDate: null,
    });
  });

  it('parses fullTextAnnotation.text into extracted fields when Vision detects text', async () => {
    config.get.mockReturnValue('fake-api-key');
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          responses: [
            { fullTextAnnotation: { text: 'HPCL Depot\nQuantity: 1000 Ltrs' } },
          ],
        }),
    });

    const result = await service.extractInvoiceFields(Buffer.from('image'));

    expect(result.rawText).toContain('HPCL');
    expect(result.extractedFields.supplierName).toBe('HPCL (Hindustan Petroleum)');
    expect(result.extractedFields.quantityLitres).toBe(1000);
  });

  it('throws BadGatewayException when the Vision API responds with a non-OK HTTP status', async () => {
    config.get.mockReturnValue('fake-api-key');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('API key invalid'),
    });

    await expect(
      service.extractInvoiceFields(Buffer.from('image')),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGatewayException when Vision returns a per-request error payload', async () => {
    config.get.mockReturnValue('fake-api-key');
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          responses: [{ error: { message: 'Bad image data' } }],
        }),
    });

    await expect(
      service.extractInvoiceFields(Buffer.from('image')),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGatewayException when the fetch call itself rejects (network failure)', async () => {
    config.get.mockReturnValue('fake-api-key');
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      service.extractInvoiceFields(Buffer.from('image')),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
