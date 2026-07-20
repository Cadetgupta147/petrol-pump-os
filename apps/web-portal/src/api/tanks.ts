import { apiFetch } from './client';
import type { Tank, VarianceReportRow } from './types';

// GET /tanks — Section 7.1. Owner/Accountant only server-side
// (@Roles(Role.OWNER, Role.ACCOUNTANT) on TanksController) — a DSM hitting
// this page gets a 403 from the backend, surfaced as an ApiError like every
// other page in this app. Tank creation/editing isn't wired up here; nothing
// in this codebase's UI creates a Tank row yet.
export function getTanks(): Promise<Tank[]> {
  return apiFetch<Tank[]>('/tanks');
}

// GET /tanks/variance-report — Section 7.2 step 3. One row per tank
// (including tanks never dipped, with latestDipReading: null) — see
// TanksService.varianceReport() for why this is derived from
// Tank.currentStockLitres rather than re-aggregated from purchase/sale
// history.
export function getVarianceReport(): Promise<VarianceReportRow[]> {
  return apiFetch<VarianceReportRow[]>('/tanks/variance-report');
}
