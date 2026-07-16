import { apiFetch } from './client';
import type { Bill } from './types';

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
