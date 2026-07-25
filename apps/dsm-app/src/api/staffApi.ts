import { API_BASE_URL } from '../config';

// GET /staff — StaffController.findAll() (apps/backend/src/staff). Minimal
// id+name directory, active staff only. Used by the batch-close screen's
// per-row staff picker for a non-DSM caller — a DSM caller can only ever
// attribute a reading to themselves (resolveAssignableActorId() enforces
// this server-side regardless), so the picker never renders for that role.
export interface StaffListItem {
  id: string;
  name: string;
}

export class StaffApiError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

export async function listStaff(accessToken: string): Promise<StaffListItem[]> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}/staff`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch {
      throw new StaffApiError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new StaffApiError('Could not load the staff list.');
  }

  return (await response.json()) as StaffListItem[];
}
