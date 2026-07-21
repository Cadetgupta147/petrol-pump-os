import { apiFetch } from './client';
import type { CreateStaffRequest, Staff, UpdateStaffRequest } from './types';

// GET /staff-management — Owner/Accountant. Full staff master (never a
// credential hash) — distinct from GET /staff's minimal id+name picker
// (api/staff.ts), which stays as-is for its existing dropdown consumers.
export function getManagedStaff(): Promise<Staff[]> {
  return apiFetch<Staff[]>('/staff-management');
}

// POST /staff-management — Owner-only server-side. Exactly one of
// dto.pin/dto.password is expected, matching dto.role.
export function createStaff(dto: CreateStaffRequest): Promise<Staff> {
  return apiFetch<Staff>('/staff-management', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// PATCH /staff-management/:id — Owner-only server-side. Role isn't
// editable; pin/password are only sent to reset a credential.
export function updateStaff(id: string, dto: UpdateStaffRequest): Promise<Staff> {
  return apiFetch<Staff>(`/staff-management/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}
