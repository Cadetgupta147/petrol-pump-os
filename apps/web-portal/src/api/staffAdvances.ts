import { apiFetch } from './client';
import type { CreateStaffAdvanceRequest, StaffAdvance } from './types';

// GET /staff-advances — Section 17.23. Owner/Accountant/Manager server-side.
export function getStaffAdvances(): Promise<StaffAdvance[]> {
  return apiFetch<StaffAdvance[]>('/staff-advances');
}

// POST /staff-advances — staffId omitted defaults to the caller server-side
// (resolveAssignableActorId) — the web portal always sends it explicitly
// since it's picking a staff member from a list, not recording for itself.
export function createStaffAdvance(dto: CreateStaffAdvanceRequest): Promise<StaffAdvance> {
  return apiFetch<StaffAdvance>('/staff-advances', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// PATCH /staff-advances/:id/repay — all-or-nothing (see StaffAdvance's
// comment) — marks the full amount settled.
export function markStaffAdvanceRepaid(id: string): Promise<StaffAdvance> {
  return apiFetch<StaffAdvance>(`/staff-advances/${id}/repay`, { method: 'PATCH' });
}
