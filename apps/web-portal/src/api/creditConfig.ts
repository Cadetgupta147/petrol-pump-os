import { apiFetch } from './client';
import type { CreditConfig, UpdateCreditConfigRequest } from './types';

// GET /credit-config — Section 3.4A. Owner-only server-side (narrowed from
// Owner/Accountant — see credit-config.controller.ts). Unlike
// /loyalty-config this never 404s: CreditConfigService.getOrCreate() is an
// upsert-on-read singleton, so there's no null/"not configured yet" case to
// handle here.
export function getCreditConfig(): Promise<CreditConfig> {
  return apiFetch<CreditConfig>('/credit-config');
}

// PATCH /credit-config — Owner-ONLY server-side (Section 2: credit
// enforcement policy is business-settings policy, one of Accountant's
// carve-outs). The UI hides the form for non-owners too, but the
// @Roles(Role.OWNER) guard on the backend is the real enforcement.
export function updateCreditConfig(
  dto: UpdateCreditConfigRequest,
): Promise<CreditConfig> {
  return apiFetch<CreditConfig>('/credit-config', {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}
