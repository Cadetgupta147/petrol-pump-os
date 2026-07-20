import { BadGatewayException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExtractedInvoiceFields,
  parseInvoiceText,
} from './invoice-text-parser.util';

const VISION_API_URL = 'https://vision.googleapis.com/v1/images:annotate';

export interface OcrExtractionResult {
  extractedFields: ExtractedInvoiceFields;
  rawText: string;
}

const NULL_FIELDS: ExtractedInvoiceFields = {
  supplierName: null,
  productType: null,
  quantityLitres: null,
  ratePerLitre: null,
  amount: null,
  invoiceNo: null,
  tankerNo: null,
  invoiceDate: null,
};

// Section 9 — OCR for supplier/tanker invoices via Google Cloud Vision's
// DOCUMENT_TEXT_DETECTION feature (resolved choice, see CLAUDE.md "Resolved
// since the plan update" — plain text detection is sufficient for these
// printed/structured documents, and keeps this on Vision's flat
// ~$1.50/1,000-page tier rather than a structured-extraction tier).
//
// This service ONLY extracts + parses. It never creates a PurchaseEntry or
// touches Tank stock — that still goes through the existing, unmodified
// POST /purchase-entries, only after a human has reviewed/corrected
// whatever this returns (Section 9's own "always shown for verification"
// requirement).
@Injectable()
export class OcrService {
  constructor(private readonly config: ConfigService) {}

  async extractInvoiceFields(imageBuffer: Buffer): Promise<OcrExtractionResult> {
    const apiKey = this.config.get<string>('GOOGLE_CLOUD_VISION_API_KEY');
    if (!apiKey) {
      // Mirrors LoyaltyService's "config not set, here's what to do"
      // ConflictException pattern rather than a bare 500 — this is a
      // dealer-configuration gap, not a server bug.
      throw new ConflictException(
        'Google Cloud Vision is not configured — the Owner must set GOOGLE_CLOUD_VISION_API_KEY in .env before OCR extraction can run (see docs/master-plan.md Section 9)',
      );
    }

    const base64Image = imageBuffer.toString('base64');

    let response: Response;
    try {
      response = await fetch(`${VISION_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Image },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            },
          ],
        }),
      });
    } catch {
      throw new BadGatewayException(
        'Could not reach Google Cloud Vision — check network connectivity and try again',
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new BadGatewayException(
        `Google Cloud Vision request failed (HTTP ${response.status}): ${errorBody}`,
      );
    }

    const body = (await response.json()) as {
      responses?: Array<{
        fullTextAnnotation?: { text?: string };
        error?: { message?: string };
      }>;
    };
    const visionResponse = body.responses?.[0];

    if (visionResponse?.error) {
      throw new BadGatewayException(
        `Google Cloud Vision returned an error: ${visionResponse.error.message ?? 'unknown error'}`,
      );
    }

    const rawText = visionResponse?.fullTextAnnotation?.text ?? '';

    // A blank/unreadable image is an expected outcome (bad photo, blank
    // page), not a bug — respond with all-null fields rather than erroring,
    // per Section 9.
    if (!rawText.trim()) {
      return { extractedFields: { ...NULL_FIELDS }, rawText: '' };
    }

    return {
      extractedFields: parseInvoiceText(rawText),
      rawText,
    };
  }
}
