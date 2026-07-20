import { apiFetch } from './client';
import type { SalesPurchaseRegister } from './types';

// GET /sales-purchase-register?from=&to= — Section 12. Owner/Accountant/
// Read-only server-side. from/to are YYYY-MM-DD strings (DateRangeQueryDto).
// See SalesPurchaseRegisterService's class comment for taxModelingGap — this
// is a plain register, not a real GST tax-rate breakup, and the response's
// taxModelingGap string must stay visible in the UI, not just fetched.
export function getSalesPurchaseRegister(
  from: string,
  to: string,
): Promise<SalesPurchaseRegister> {
  const params = new URLSearchParams({ from, to });
  return apiFetch<SalesPurchaseRegister>(`/sales-purchase-register?${params.toString()}`);
}
