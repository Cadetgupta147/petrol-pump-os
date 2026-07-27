import { apiFetch } from './client';
import type { CreditLimitSuggestionsReport } from './types';

// GET /credit-limit-suggestions — Section 17.25. Owner/Accountant/Read-only
// server-side. Read-only computed suggestions — applying one is just a
// normal PATCH /customers/:id (updateCustomer), same auditable path as any
// other credit-limit edit; no separate "apply" endpoint exists.
export function getCreditLimitSuggestions(): Promise<CreditLimitSuggestionsReport> {
  return apiFetch<CreditLimitSuggestionsReport>('/credit-limit-suggestions');
}
