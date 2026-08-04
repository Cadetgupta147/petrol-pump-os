import { apiFetch } from './client';
import type { DsrReport, NozzleWiseSalesReport, VehicleWiseSalesReport } from './types';

// GET /reports/nozzle-wise-sales, /reports/vehicle-wise-sales — Section 12.
// Owner/Accountant server-side. ?from=&to= optional, both default to today
// when omitted (same convention as GET /dashboard/sales-summary).
export function getNozzleWiseSales(from?: string, to?: string): Promise<NozzleWiseSalesReport> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return apiFetch<NozzleWiseSalesReport>(`/reports/nozzle-wise-sales${query ? `?${query}` : ''}`);
}

export function getVehicleWiseSales(from?: string, to?: string): Promise<VehicleWiseSalesReport> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return apiFetch<VehicleWiseSalesReport>(`/reports/vehicle-wise-sales${query ? `?${query}` : ''}`);
}

// GET /reports/dsr?date= — Section 12B Daily Sales Report. Single day only
// (not from/to like the two reports above) — omitted -> today.
export function getDailySalesReport(date?: string): Promise<DsrReport> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  return apiFetch<DsrReport>(`/reports/dsr${qs}`);
}
