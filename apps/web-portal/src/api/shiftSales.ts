import { apiFetch } from './client';
import type { ShiftSalesSummary } from './types';

// GET /shift-sales — Section 8A.2. Every ShiftSalesSummary row, newest first
// (ShiftSalesService.findAll()). Owner/Accountant/Manager only server-side —
// no Read-only or DSM override on this route, unlike CashCustodyController's
// 'report' route, so this call 403s for those roles (handled as "context
// unavailable for your role" by the caller, not a fatal page error).
export function getShiftSalesSummaries(): Promise<ShiftSalesSummary[]> {
  return apiFetch<ShiftSalesSummary[]>('/shift-sales');
}
