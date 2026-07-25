import { API_BASE_URL } from '../config';

// Meter Reading redesign (Section 3.3) — mirrors the backend contract
// exactly (apps/backend/src/shift-schedule/*). Used purely to show a
// "Now closing: Shift 2 (14:00-22:00)" style header on the batch-close
// screen — NEVER to validate or block a submission (see the backend's
// resolve-current-shift-window.ts for why exact clock-time precision
// doesn't matter here).
export interface CurrentShiftWindow {
  shiftDefinition: { id: string; label: string; startTime: string; endTime: string };
  windowStart: string;
  windowEnd: string;
}

export class ShiftScheduleApiError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

// GET /shift-schedule/current — null is a normal, expected result (nothing
// configured yet, or "now" falls in a genuine gap between shifts), not an
// error this function throws for.
export async function getCurrentShiftWindow(accessToken: string): Promise<CurrentShiftWindow | null> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}/shift-schedule/current`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch {
      throw new ShiftScheduleApiError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new ShiftScheduleApiError('Could not load the current shift.');
  }

  return (await response.json()) as CurrentShiftWindow | null;
}
