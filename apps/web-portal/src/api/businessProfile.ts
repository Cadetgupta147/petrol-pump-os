import { apiFetch } from './client';
import type { BusinessProfile, UpdateBusinessProfileRequest } from './types';

// GET /business-profile — Owner/Accountant. Section 3.9.
export function getBusinessProfile(): Promise<BusinessProfile> {
  return apiFetch<BusinessProfile>('/business-profile');
}

// PATCH /business-profile — Owner-only server-side (Section 2: "cannot
// change business settings" is an explicit Accountant carve-out).
export function updateBusinessProfile(dto: UpdateBusinessProfileRequest): Promise<BusinessProfile> {
  return apiFetch<BusinessProfile>('/business-profile', {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}
