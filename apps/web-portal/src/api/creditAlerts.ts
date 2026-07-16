import { apiFetch } from './client';
import type { CreditLimitAlert } from './types';

// GET /credit-alerts — every CreditLimitAlert ever recorded, newest first.
// These fire when a bill pushed a customer over their credit limit while
// CreditConfig.enforcementMode = NOTIFY (see BillsService). Important
// framing: this is "over the configured limit", not "payment overdue" — the
// schema has no due-date concept, so an "overdue" alert as such doesn't
// exist yet. The dashboard labels these as credit limit alerts accordingly
// rather than implying an aging/overdue check that isn't there.
export function getCreditAlerts(): Promise<CreditLimitAlert[]> {
  return apiFetch<CreditLimitAlert[]>('/credit-alerts');
}
