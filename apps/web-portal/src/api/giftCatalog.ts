import { apiFetch } from './client';
import type { GiftRedemptionReportRow } from './types';

// GET /gift-catalog/redemption-report — Section 12. Owner/Read-only server-
// side (GiftCatalogController.getRedemptionReport()).
export function getGiftRedemptionReport(): Promise<GiftRedemptionReportRow[]> {
  return apiFetch<GiftRedemptionReportRow[]>('/gift-catalog/redemption-report');
}
