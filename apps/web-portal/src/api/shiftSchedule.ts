import { apiFetch } from './client';
import type {
  CreateShiftDefinitionRequest,
  CurrentShiftWindow,
  ShiftDefinition,
  UpdateShiftDefinitionRequest,
} from './types';

// GET /shift-schedule — Meter Reading redesign (Section 3.3): the Owner-
// configurable shift schedule. includeInactive is only ever passed true by
// the Shift Schedule Settings screen (so a disabled shift can still be
// found and re-enabled) — every other caller omits it and gets active
// shift definitions only, mirroring getNozzles()'s own convention.
export function getShiftDefinitions(includeInactive = false): Promise<ShiftDefinition[]> {
  return apiFetch<ShiftDefinition[]>(`/shift-schedule${includeInactive ? '?includeInactive=true' : ''}`);
}

// POST /shift-schedule — Settings: add a named shift window. Owner/
// Accountant only.
export function createShiftDefinition(dto: CreateShiftDefinitionRequest): Promise<ShiftDefinition> {
  return apiFetch<ShiftDefinition>('/shift-schedule', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// PATCH /shift-schedule/:id — rename, change times, or soft-disable
// (isActive: false).
export function updateShiftDefinition(
  id: string,
  dto: UpdateShiftDefinitionRequest,
): Promise<ShiftDefinition> {
  return apiFetch<ShiftDefinition>(`/shift-schedule/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// GET /shift-schedule/current — the resolved current/most-recent shift
// window, for display only (e.g. the DSM app's batch-close screen header).
// null when nothing is configured or "now" falls in a schedule gap.
export function getCurrentShiftWindow(): Promise<CurrentShiftWindow | null> {
  return apiFetch<CurrentShiftWindow | null>('/shift-schedule/current');
}
