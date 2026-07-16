import { apiFetch } from './client';
import type { SalesSummary, TankStock, RecentBill } from './types';

// GET /dashboard/sales-summary — server-computed "today" (server's local
// calendar day, see getStartAndEndOfToday() in dashboard.service.ts). There
// is no date-range parameter on this endpoint yet, which is why the
// dashboard's date tabs only make "Today" selectable — see DateRangeTabs.
export function getSalesSummary(): Promise<SalesSummary> {
  return apiFetch<SalesSummary>('/dashboard/sales-summary');
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
