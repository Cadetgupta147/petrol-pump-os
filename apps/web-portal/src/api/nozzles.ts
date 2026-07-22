import { apiFetch } from './client';
import type { CreateNozzleRequest, Nozzle, UpdateNozzleRequest } from './types';

// GET /nozzles — Section 3.3/4 Nozzle master. Owner/Accountant/DSM server-
// side (DSM app needs this too, for its shift-start/close picker), but only
// Owner/Accountant reach this page (Section 2: DSM has no web portal
// access). includeInactive is only ever passed true by the Nozzle Settings
// screen (so a disabled nozzle can still be found and re-enabled) — every
// real shift-open picker omits it and gets active nozzles only, each with a
// server-computed nextOpeningReading preview (the carry-forward rule's
// result) — never an editable field anywhere in this app.
export function getNozzles(includeInactive = false): Promise<Nozzle[]> {
  return apiFetch<Nozzle[]>(`/nozzles${includeInactive ? '?includeInactive=true' : ''}`);
}

// POST /nozzles — Settings: add a nozzle/meter, its Item Master link, and
// its one-time starting reading. Owner/Accountant only.
export function createNozzle(dto: CreateNozzleRequest): Promise<Nozzle> {
  return apiFetch<Nozzle>('/nozzles', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// PATCH /nozzles/:id — rename, change item mapping, set/clear the rollover
// point, soft-disable (isActive: false — rejected with a 409 while an open
// shift exists), or correct startingReading (rejected with a 409 once this
// nozzle has any shift history — see UpdateNozzleRequest).
export function updateNozzle(id: string, dto: UpdateNozzleRequest): Promise<Nozzle> {
  return apiFetch<Nozzle>(`/nozzles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}
