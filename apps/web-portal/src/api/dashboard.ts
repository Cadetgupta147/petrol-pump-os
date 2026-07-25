import { apiFetch } from './client';
import type { SalesSummary, TankStock, RecentBill } from './types';

// GET /dashboard/sales-summary?from=&to= — Section 3.1 date-range tabs
// (DateRangeTabs resolves Today/Yesterday/This week/This month into a
// concrete from/to pair client-side). Omitting both preserves the original
// server-computed "today" (server's local calendar day).
export function getSalesSummary(from?: string, to?: string): Promise<SalesSummary> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return apiFetch<SalesSummary>(`/dashboard/sales-summary${qs ? `?${qs}` : ''}`);
}

// GET /dashboard/tank-stock — one row per Tank. lastDipReading/lastDipAt are
// nullable: a tank with no DIP entry yet returns null for both.
export function getTankStock(): Promise<TankStock[]> {
  return apiFetch<TankStock[]>('/dashboard/tank-stock');
}

// GET /dashboard/recent-bills — most recent 20 non-deleted bills, newest
// first (RECENT_BILLS_LIMIT in dashboard.service.ts). Not filtered to today.
export function getRecentBills(): Promise<RecentBill[]> {
  return apiFetch<RecentBill[]>('/dashboard/recent-bills');
}
