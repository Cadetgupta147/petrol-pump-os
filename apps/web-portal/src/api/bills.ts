import { apiFetch } from './client';
import type { Bill, BillsListResponse, ListBillsFilters, UpdateBillRequest } from './types';

// GET /bills?... — Section 3.2 bill register: filters (date range, customer,
// DSM/staff, payment type, vehicle number) + opt-in pagination
// (BillsService.findAll()). Calling with no filters preserves the old
// behavior (every non-deleted bill, unbounded) — DashboardPage still relies
// on that for its client-side today/all-time split, since
// /dashboard/sales-summary only returns a combined total across product
// types. On a pump with years of history that unfiltered call will get
// slow; the proper long-term fix is a dedicated server-aggregated dashboard
// endpoint, not something this filtering slice changes.
export function getAllBills(filters: ListBillsFilters = {}): Promise<BillsListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return apiFetch<BillsListResponse>(`/bills${qs ? `?${qs}` : ''}`);
}

export function getBill(id: string): Promise<Bill> {
  return apiFetch<Bill>(`/bills/${id}`);
}

// PATCH /bills/:id — Owner/Accountant server-side (class-level
// @Roles(Role.OWNER, Role.ACCOUNTANT) on BillsController, no method-level
// override on update()). See UpdateBillRequest in types.ts for the field
// list this page edits.
export function updateBill(id: string, dto: UpdateBillRequest): Promise<Bill> {
  return apiFetch<Bill>(`/bills/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// DELETE /bills/:id — Owner-only server-side (method-level @Roles(Role.OWNER)
// override on remove(), deliberately narrower than PATCH — see the comment
// on BillsController.remove()). Soft-delete: the actor is derived server-side
// from the caller's JWT (finding A1, docs/production-readiness.md) — no body.
export function deleteBill(id: string): Promise<Bill> {
  return apiFetch<Bill>(`/bills/${id}`, {
    method: 'DELETE',
  });
}
