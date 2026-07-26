import { apiFetch } from './client';
import type { DensityLog } from './types';

// GET /density-logs — Section 7.3. Owner/Accountant only server-side. No
// server-side default filter — same convention as getPurchaseEntries()
// (no query param support beyond the optional ones below) — callers filter
// client-side when they only care about a subset.
export function getDensityLogs(params?: {
  tankId?: string;
  purchaseEntryId?: string;
  dipReadingId?: string;
}): Promise<DensityLog[]> {
  const query = new URLSearchParams();
  if (params?.tankId) query.set('tankId', params.tankId);
  if (params?.purchaseEntryId) query.set('purchaseEntryId', params.purchaseEntryId);
  if (params?.dipReadingId) query.set('dipReadingId', params.dipReadingId);
  const qs = query.toString();
  return apiFetch<DensityLog[]>(`/density-logs${qs ? `?${qs}` : ''}`);
}
