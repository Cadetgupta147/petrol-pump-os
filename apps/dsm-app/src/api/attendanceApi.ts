import { API_BASE_URL } from '../config';

// Mirrors the backend contract exactly (apps/backend/src/attendance/*,
// Section 12). All routes here require a valid JWT (global JwtAuthGuard) —
// every call takes the caller's accessToken and sends it as
// `Authorization: Bearer <token>`.
export interface AttendanceLog {
  id: string;
  staffId: string;
  clockIn: string;
  clockOut: string | null;
}

export interface MyAttendanceStatus {
  openLog: AttendanceLog | null;
}

// Thrown for both "server reachable but rejected the request" (e.g. 409 —
// already clocked in / already clocked out) and "server unreachable".
export class AttendanceApiError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

async function request<T>(
  path: string,
  options: { method: 'GET' | 'POST' | 'PATCH'; accessToken: string },
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
        signal: controller.signal,
      });
    } catch {
      throw new AttendanceApiError(
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
    throw new AttendanceApiError(message);
  }

  return (await response.json()) as T;
}

// GET /attendance/me — self-only status check (never accepts a staffId; see
// AttendanceService.getMyStatus()). Lets the DSM app show "clocked in since
// HH:MM" / "not clocked in" and get the log id clockOut() needs, without
// requiring GET /attendance itself (Owner/Accountant/Manager only).
export function getMyAttendanceStatus(accessToken: string): Promise<MyAttendanceStatus> {
  return request<MyAttendanceStatus>('/attendance/me', { method: 'GET', accessToken });
}

// POST /attendance/clock-in — staffId omitted, so the server defaults it to
// the caller (resolveAssignableActorId()). A DSM can only ever clock
// themselves in from this app.
export function clockIn(accessToken: string): Promise<AttendanceLog> {
  return request<AttendanceLog>('/attendance/clock-in', { method: 'POST', accessToken });
}

export function clockOut(logId: string, accessToken: string): Promise<AttendanceLog> {
  return request<AttendanceLog>(`/attendance/${logId}/clock-out`, { method: 'PATCH', accessToken });
}
