import { ApiError, apiFetch } from './client';
import type { LoyaltyConfig, LoyaltyCostReport, UpsertLoyaltyConfigRequest } from './types';

// GET /loyalty-config — Section 6.2. Owner/Accountant server-side. The
// backend answers 404 until the Owner has configured loyalty (no hardcoded
// defaults — Section 17 open decision); that specific 404 is translated to
// null here so the settings page renders "not configured yet", not an error.
export async function getLoyaltyConfig(): Promise<LoyaltyConfig | null> {
  try {
    return await apiFetch<LoyaltyConfig>('/loyalty-config');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// PUT /loyalty-config — Owner-ONLY server-side (Section 2: "Accountant
// cannot change loyalty rates"). The UI hides the form for non-owners too,
// but the @Roles(Role.OWNER) guard on the backend is the real enforcement.
export function upsertLoyaltyConfig(
  dto: UpsertLoyaltyConfigRequest,
): Promise<LoyaltyConfig> {
  return apiFetch<LoyaltyConfig>('/loyalty-config', {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
}

// GET /loyalty/cost-report — Section 12. Owner/Read-only server-side (not
// Accountant — narrower than most other reports, matching how loyalty-rate/
// redemption config writes are already Owner-only — see LoyaltyController).
export function getLoyaltyCostReport(): Promise<LoyaltyCostReport> {
  return apiFetch<LoyaltyCostReport>('/loyalty/cost-report');
}
