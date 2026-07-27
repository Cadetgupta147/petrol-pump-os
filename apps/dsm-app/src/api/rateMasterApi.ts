import { API_BASE_URL } from '../config';

// GET /rate-master/current?productType=X — Section 7.4. DSM gets a narrow,
// method-level @Roles override on just this route (full history / create
// stay Owner/Accountant-only, see rate-master.controller.ts's comment) — the
// New Bill screen uses this purely to auto-calculate litres from amount (or
// vice versa) before Save; the server still resolves rateApplied itself
// authoritatively at bill-creation time regardless (BillsService.create()).
export interface CurrentRate {
  id: string;
  productType: string;
  rate: number;
  effectiveFrom: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

// Returns null on ANY failure (no Rate Master entry configured for this
// product yet — a 404 — same as a network hiccup or timeout): this call is
// a pure auto-calc convenience, never something the New Bill screen should
// show a scary error for. The DSM can always type both amount and litres by
// hand regardless.
export async function getCurrentRate(
  productType: string,
  accessToken: string,
): Promise<CurrentRate | null> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(
        `${API_BASE_URL}/rate-master/current?productType=${encodeURIComponent(productType)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        },
      );
    } catch {
      return null;
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) return null;
  return (await response.json()) as CurrentRate;
}
