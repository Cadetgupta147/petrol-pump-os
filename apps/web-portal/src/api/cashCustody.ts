import { apiFetch } from './client';
import type { CashCustodyLog, CashCustodyReportRow, CreateCashCustodyLogRequest } from './types';

// POST /cash-custody — Section 8.1. Roles allowed server-side: Owner/
// Accountant/Manager/DSM (CashCustodyController.create()). The 3-way-split
// AND broughtBackToday-vs-outstanding validations are enforced there
// (CashCustodyService.create()) — this call surfaces whatever 400 it returns
// verbatim; the frontend's live validation (CashCustodyPage) only mirrors the
// same rule for immediate feedback, it isn't the real enforcement.
export function createCashCustodyLog(
  dto: CreateCashCustodyLogRequest,
): Promise<CashCustodyLog> {
  return apiFetch<CashCustodyLog>('/cash-custody', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// GET /cash-custody — every entry, newest date first (CashCustodyService.
// findAll()). Owner/Accountant/Manager only server-side — no DSM/Read-only
// override on this route, unlike POST and 'report' below.
export function getCashCustodyLogs(): Promise<CashCustodyLog[]> {
  return apiFetch<CashCustodyLog[]>('/cash-custody');
}

// GET /cash-custody/report — Section 8.1 step 3, the per-person outstanding
// balance report. Owner/Accountant/Manager/Read-only server-side (no DSM
// override) — a DSM calling this gets a 403, handled by callers as "context
// unavailable for your role", not a fatal page error.
export function getCashCustodyReport(): Promise<CashCustodyReportRow[]> {
  return apiFetch<CashCustodyReportRow[]>('/cash-custody/report');
}
