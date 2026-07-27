import { apiFetch } from './client';
import type { CreateTankRequest, Tank, UpdateTankRequest, VarianceReportRow } from './types';

// GET /tanks — Section 7.1. Owner/Accountant only server-side
// (@Roles(Role.OWNER, Role.ACCOUNTANT) on TanksController) — a DSM hitting
// this page gets a 403 from the backend, surfaced as an ApiError like every
// other page in this app.
export function getTanks(): Promise<Tank[]> {
  return apiFetch<Tank[]>('/tanks');
}

// POST /tanks — Tank Master (Settings): register a new physical tank.
// Owner/Accountant only.
export function createTank(dto: CreateTankRequest): Promise<Tank> {
  return apiFetch<Tank>('/tanks', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// PATCH /tanks/:id — any subset of productType/capacityLitres/
// currentStockLitres/calibrationChartRef.
export function updateTank(id: string, dto: UpdateTankRequest): Promise<Tank> {
  return apiFetch<Tank>(`/tanks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// DELETE /tanks/:id — TanksService.remove() rejects (409) a tank that still
// holds stock, has any nozzle linked to it, or has recorded DIP/density/
// generator/testing history — surfaced as-is, not re-checked client-side.
export function deleteTank(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/tanks/${id}`, { method: 'DELETE' });
}

// GET /tanks/variance-report — Section 7.2 step 3. One row per tank
// (including tanks never dipped, with latestDipReading: null) — see
// TanksService.varianceReport() for why this is derived from
// Tank.currentStockLitres rather than re-aggregated from purchase/sale
// history.
export function getVarianceReport(): Promise<VarianceReportRow[]> {
  return apiFetch<VarianceReportRow[]>('/tanks/variance-report');
}
