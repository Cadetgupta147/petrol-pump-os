import { API_BASE_URL } from '../config';

// Mirrors the backend contract exactly (apps/backend/src/shift-sales/*,
// Section 8A.2 — walk-in aggregate sales summary). All routes here require a
// valid JWT (global JwtAuthGuard) — every call takes the caller's
// accessToken and sends it as `Authorization: Bearer <token>`.
export interface ShiftSalesSummary {
  id: string;
  shiftId: string;
  dsmId: string;
  nozzleId: string;
  walkInLitres: number;
  walkInCashCollected: number;
  walkInUpiCollected: number;
  walkInCardCollected: number;
  expectedValue: number;
  variance: number;
  createdAt: string;
  // Present only on a create response when the server clamped a negative
  // computed walkInLitres to 0 — see ShiftSalesService.create().
  warning?: string;
}

// Thrown for both "server reachable but rejected the request" (e.g. 409 —
// a summary already exists for this shift; 400 — shift still open, or
// walkInUpiCollected sent while auto-capture is on) and "server unreachable".
export class ShiftSalesApiError extends Error {}

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
      throw new ShiftSalesApiError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = 'The server rejected this request.';
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (typeof body.message === 'string' && body.message.length > 0) {
        message = body.message;
      } else if (Array.isArray(body.message) && body.message.length > 0) {
        message = body.message.join(', ');
      }
    } catch {
      // Body wasn't valid JSON — fall back to the generic message above.
    }
    throw new ShiftSalesApiError(message);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }
  return (await response.json()) as T;
}

// No `?shiftId=` filter server-side (same convention as listMeterReadings) —
// callers filter client-side for the shift(s) they care about.
export async function listShiftSalesSummaries(accessToken: string): Promise<ShiftSalesSummary[]> {
  return request<ShiftSalesSummary[]>('/shift-sales', { method: 'GET', accessToken });
}

export interface CreateShiftSalesSummaryParams {
  shiftId: string;
  walkInCashCollected?: number;
  walkInCardCollected?: number;
  // Only accepted by the server while this pump's UpiCaptureConfig has
  // autoCaptureEnabled=false — omit when auto-capture is on (see
  // ShiftSalesSummaryScreen, which reads /upi-capture-config to decide).
  walkInUpiCollected?: number;
}

export async function createShiftSalesSummary(
  params: CreateShiftSalesSummaryParams,
  accessToken: string,
): Promise<ShiftSalesSummary> {
  return request<ShiftSalesSummary>('/shift-sales', { method: 'POST', body: params, accessToken });
}

export type UpdateShiftSalesSummaryParams = Omit<CreateShiftSalesSummaryParams, 'shiftId'>;

export async function updateShiftSalesSummary(
  id: string,
  params: UpdateShiftSalesSummaryParams,
  accessToken: string,
): Promise<ShiftSalesSummary> {
  return request<ShiftSalesSummary>(`/shift-sales/${id}`, {
    method: 'PATCH',
    body: params,
    accessToken,
  });
}
