import { API_BASE_URL } from '../config';
import type { Nozzle } from './nozzlesApi';

// Mirrors the backend contract exactly (apps/backend/src/meter-readings/*,
// Section 3.3 / Section 4 "Shift start/end: meter reading"). All routes here
// require a valid JWT (global JwtAuthGuard) — every call takes the caller's
// accessToken and sends it as `Authorization: Bearer <token>`.
export interface MeterReading {
  id: string;
  nozzleId: string;
  // Section 3.3/4 — the full Nozzle master row this reading's nozzleId
  // points at, always included server-side (`include: { nozzle: true }`) so
  // this screen can show the dealer-facing label/product without a second
  // round trip.
  nozzle: Nozzle;
  staffId: string;
  openingReading: number;
  closingReading: number | null;
  shiftStart: string;
  shiftEnd: string | null;
  // Computed server-side, not persisted: null while the shift is still open.
  litresSold: number | null;
}

// Thrown for both "server reachable but rejected the request" (e.g. 409 —
// nozzle already has an open shift; 400 — closingReading < openingReading;
// 404 — unknown meter reading id) and "server unreachable" (offline / wrong
// API base URL). The message differs so the UI can guide the DSM correctly,
// but neither case is ever treated as success.
export class MeterReadingsApiError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

async function request<T>(
  path: string,
  options: { method: 'GET' | 'POST' | 'PATCH'; body?: unknown; accessToken: string },
): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.accessToken}`,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      // Same reasoning as authApi.ts: fetch() throws on network failure or
      // on the AbortController firing after REQUEST_TIMEOUT_MS — both are
      // "couldn't reach the server", not distinct cases. Meter reading entry
      // itself is NOT part of the offline-queue slice (Section 15.3 is a
      // separate, later piece of work) — this call needs a live round trip.
      throw new MeterReadingsApiError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    // Surface the backend's own `message` field verbatim (e.g. the 409
    // "already has an open shift" or 400 "closingReading cannot be less
    // than..." messages) — fall back to a generic message only if the body
    // isn't parseable JSON.
    let message = 'The server rejected this request.';
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (typeof body.message === 'string' && body.message.length > 0) {
        message = body.message;
      } else if (Array.isArray(body.message) && body.message.length > 0) {
        // Nest's default ValidationPipe returns `message` as an array of
        // per-field errors rather than a single string — join them so the
        // DSM sees every issue, not just "[object Object]".
        message = body.message.join(', ');
      }
    } catch {
      // Body wasn't valid JSON — fall back to the generic message above.
    }
    throw new MeterReadingsApiError(message);
  }

  // 204 No Content isn't used by this API today, but guard anyway.
  if (response.status === 204) {
    return undefined as unknown as T;
  }
  return (await response.json()) as T;
}

// Section 3.3/4 — openingReading and productType are DELIBERATELY ABSENT
// from params: both are now server-derived (the carry-forward rule +
// Nozzle.productType). A DSM picks a nozzleId from GET /nozzles and cannot
// set or edit the opening reading at all.
export async function openShift(
  params: { nozzleId: string; staffId: string },
  accessToken: string,
): Promise<MeterReading> {
  return request<MeterReading>('/meter-readings', {
    method: 'POST',
    body: params,
    accessToken,
  });
}

export async function closeShift(
  id: string,
  closingReading: number,
  accessToken: string,
): Promise<MeterReading> {
  return request<MeterReading>(`/meter-readings/${id}/close`, {
    method: 'PATCH',
    body: { closingReading },
    accessToken,
  });
}

// No `?nozzleId=` filter server-side (see task spec) — callers filter
// client-side for the nozzle/open-shift they care about.
export async function listMeterReadings(accessToken: string): Promise<MeterReading[]> {
  return request<MeterReading[]>('/meter-readings', {
    method: 'GET',
    accessToken,
  });
}
