import { apiFetch } from './client';
import type { CreateNozzleRequest, Nozzle, UpdateNozzleRequest } from './types';

// GET /nozzles — Section 3.3/4 Nozzle master. Owner/Accountant/DSM server-
// side (DSM app needs this too, for its shift-start/close picker), but only
// Owner/Accountant reach this page (Section 2: DSM has no web portal
// access). Active nozzles only, each with a server-computed
// nextOpeningReading preview (the carry-forward rule's result) — never an
// editable field anywhere in this app.
export function getNozzles(): Promise<Nozzle[]> {
  return apiFetch<Nozzle[]>('/nozzles');
}

// POST /nozzles — Settings: add a nozzle/meter and its one-time starting
// reading. Owner/Accountant only.
export function createNozzle(dto: CreateNozzleRequest): Promise<Nozzle> {
  return apiFetch<Nozzle>('/nozzles', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// PATCH /nozzles/:id — rename, change product/tank mapping, soft-disable
// (isActive: false), or correct startingReading (rejected with a 409 by the
// backend once this nozzle has any shift history — see UpdateNozzleRequest).
export function updateNozzle(id: string, dto: UpdateNozzleRequest): Promise<Nozzle> {
  return apiFetch<Nozzle>(`/nozzles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}
