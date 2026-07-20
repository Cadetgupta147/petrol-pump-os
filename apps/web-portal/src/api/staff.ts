import { apiFetch } from './client';
import type { StaffListItem } from './types';

// GET /staff — StaffController.findAll() (apps/backend/src/staff). Minimal
// id+name directory, active staff only, for populating a "pick a person"
// dropdown (currently: CashCustodyPage's handled-by field) — not a staff-
// management endpoint. Allowed roles server-side: Owner/Accountant/Manager/
// DSM/Read-only (mirrors CashCustodyController's POST role set so Manager/
// DSM can populate their own day-end entry's dropdown).
export function getStaffList(): Promise<StaffListItem[]> {
  return apiFetch<StaffListItem[]>('/staff');
}
