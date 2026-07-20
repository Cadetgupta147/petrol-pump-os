import { apiFetch } from './client';
import type { CreateRateHistoryRequest, RateHistory } from './types';

// GET /rate-master — Section 7.4. Owner/Accountant only server-side. No
// productType filter is sent here — RateMasterPage always loads the full
// history and derives "current rate per product" client-side, rather than
// issuing a separate GET /rate-master/current request per distinct product
// (see the comment on RateMasterPage's computeCurrentRates()).
export function getRateHistory(): Promise<RateHistory[]> {
  return apiFetch<RateHistory[]>('/rate-master');
}

// POST /rate-master — append-only, no update/delete endpoint exists.
// Unique constraint on (productType, effectiveFrom); a duplicate 400/409s,
// surfaced directly via ApiError (RateMasterService.create()).
export function createRateHistory(
  dto: CreateRateHistoryRequest,
): Promise<RateHistory> {
  return apiFetch<RateHistory>('/rate-master', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}
