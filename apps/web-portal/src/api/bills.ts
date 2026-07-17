import { apiFetch } from './client';
import type { Bill, UpdateBillRequest } from './types';

// GET /bills — every non-deleted bill, no date filter and no pagination
// (BillsService.findAll()). The dashboard uses this to split today's sales
// into petrol vs diesel, since /dashboard/sales-summary only returns a
// combined total across product types. On a pump with years of history this
// will get slow — flagging that as a real gap rather than working around it
// silently; the proper fix is a backend endpoint that does this filtering
// and grouping server-side.
export function getAllBills(): Promise<Bill[]> {
  return apiFetch<Bill[]>('/bills');
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
// on BillsController.remove()). Soft-delete: the body carries deletedById
// per DeleteBillDto, same actor-attribution pattern as editedById above.
export function deleteBill(id: string, deletedById: string): Promise<Bill> {
  return apiFetch<Bill>(`/bills/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ deletedById }),
  });
}
