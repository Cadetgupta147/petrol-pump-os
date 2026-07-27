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

// POST /business-profile/logo, POST /business-profile/letterhead — Section
// 5B.2. Owner-only server-side. FormData body — apiFetch skips the default
// JSON Content-Type for FormData so the browser can set the multipart
// boundary itself (see client.ts's comment).
export function uploadBusinessLogo(file: File): Promise<BusinessProfile> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<BusinessProfile>('/business-profile/logo', {
    method: 'POST',
    body: formData,
  });
}

export function uploadBusinessLetterhead(file: File): Promise<BusinessProfile> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<BusinessProfile>('/business-profile/letterhead', {
    method: 'POST',
    body: formData,
  });
}
