import { apiFetch, ApiError, getStoredToken, parseErrorMessage } from './client';
import type {
  CreatePurchaseEntryRequest,
  OcrExtractionResult,
  PurchaseEntry,
} from './types';

const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:3000';

// POST /purchase-entries — Section 7.1/7.2. Owner/Accountant only
// server-side. 404s if no Tank exists yet for the given productType
// (PurchasesService.create() hard-blocks rather than accepting an untracked
// delivery) — that message is surfaced directly to the caller, not swallowed.
export function createPurchaseEntry(
  dto: CreatePurchaseEntryRequest,
): Promise<PurchaseEntry> {
  return apiFetch<PurchaseEntry>('/purchase-entries', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// GET /purchase-entries — most recent first (PurchasesService.findAll()).
export function getPurchaseEntries(): Promise<PurchaseEntry[]> {
  return apiFetch<PurchaseEntry[]>('/purchase-entries');
}

// POST /purchase-entries/ocr-extract — Section 9. Multipart upload, so this
// bypasses apiFetch() the same way api/tallyExport.ts's
// downloadTallyExport() bypasses it for its own non-JSON request:
// apiFetch() always sets 'Content-Type: application/json', which would
// break a FormData body (the browser needs to set its own multipart
// boundary, which it can only do if we don't set Content-Type ourselves).
//
// This call ONLY returns pre-fill data — it never creates a PurchaseEntry
// or touches Tank stock itself. See PurchaseEntryPage.tsx for the mandatory
// human-review step that always sits between this call and the actual
// POST /purchase-entries above; there is no code path here that chains
// straight from this response into a save.
export async function ocrExtractInvoice(file: File): Promise<OcrExtractionResult> {
  const token = getStoredToken();
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/purchase-entries/ocr-extract`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!response.ok) {
    // Covers the 409 "GOOGLE_CLOUD_VISION_API_KEY not configured" case
    // (OcrService) — surfaced verbatim, it's a real dealer-config gap, not
    // a bug to hide behind a generic message.
    const message = await parseErrorMessage(
      response,
      `OCR extraction failed (${response.status})`,
    );
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<OcrExtractionResult>;
}
