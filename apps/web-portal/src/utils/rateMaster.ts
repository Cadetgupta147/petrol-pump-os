import type { RateHistory } from '../api/types';

// Section 7.4 — derives "current rate per product" from the full Rate
// Master history (GET /rate-master), the same "latest effectiveFrom <= now"
// logic as RateMasterService.getCurrentRate() on the backend, just run
// client-side against a list already in hand instead of one request per
// product. Shared by RateMasterPage (its own settings table), DashboardPage
// (the Rs./L chips), and AddCreditBillModal/AddCashBillModal (amount/litres
// auto-calc) — pulled out here so they don't drift out of sync with their
// own copies.
export function computeCurrentRates(history: RateHistory[]): RateHistory[] {
  const now = Date.now();
  const current = new Map<string, RateHistory>();
  for (const row of history) {
    const effectiveAt = new Date(row.effectiveFrom).getTime();
    if (effectiveAt > now) continue; // future-dated, not yet in effect
    const existing = current.get(row.productType);
    if (!existing || effectiveAt > new Date(existing.effectiveFrom).getTime()) {
      current.set(row.productType, row);
    }
  }
  return Array.from(current.values()).sort((a, b) => a.productType.localeCompare(b.productType));
}
