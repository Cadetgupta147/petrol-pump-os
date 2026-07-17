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

// GET /credit-alerts/:id — single CreditLimitAlert with bill + customer
// included, same shape as the list endpoint above.
export function getCreditAlert(id: string): Promise<CreditLimitAlert> {
  return apiFetch<CreditLimitAlert>(`/credit-alerts/${id}`);
}

// PATCH /credit-alerts/:id — sets reminderRequested (and, server-side,
// stamps reminderRequestedAt). See CreditAlertsService.update.
export function updateCreditAlert(id: string, reminderRequested: boolean): Promise<CreditLimitAlert> {
  return apiFetch<CreditLimitAlert>(`/credit-alerts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ reminderRequested }),
  });
}
