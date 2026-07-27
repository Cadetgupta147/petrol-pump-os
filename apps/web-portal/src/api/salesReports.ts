import { apiFetch } from './client';
import type { NozzleWiseSalesReport, VehicleWiseSalesReport } from './types';

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
