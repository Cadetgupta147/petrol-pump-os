import { apiFetch } from './client';
import type { CreditAgingReport } from './types';

// GET /credit-aging/report — Section 12. Owner/Accountant/Read-only server-
// side. All-time-as-of-now snapshot, no date-range parameter — see
// CreditAgingService.getReport()'s asOf default.
export function getCreditAgingReport(): Promise<CreditAgingReport> {
  return apiFetch<CreditAgingReport>('/credit-aging/report');
}
