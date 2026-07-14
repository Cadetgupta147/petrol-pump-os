import { API_BASE_URL } from '../config';

// Mirrors the backend contract exactly (apps/backend/src/auth/dto/pin-login.dto.ts
// and auth.controller.ts `POST /auth/pin-login`, public route, Section 4).
//
// NOTE: `role` is NOT guaranteed to be "DSM" — nothing server-side restricts
// this login endpoint to DSM staff. Do not assume/hard-code the role here or
// in any screen that consumes this response.
export interface StaffSummary {
  id: string;
  name: string;
  phone: string;
  role: string;
}

export interface PinLoginResponse {
  accessToken: string;
  staff: StaffSummary;
}

// Thrown for both "server reachable but rejected the credentials" (uniform
// 401 from the backend — unknown phone, wrong PIN, inactive staff, or no PIN
// set are all indistinguishable by design, see pin-login.dto.ts) and "server
// unreachable" (offline / wrong API base URL). The message differs so the UI
// can guide the user correctly, but neither case is ever treated as a
// successful login.
export class PinLoginError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

export async function pinLogin(phone: string, pin: string): Promise<PinLoginResponse> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}/auth/pin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin }),
        signal: controller.signal,
      });
    } catch {
      // fetch() throws on network failure (no signal, wrong host, server
      // down) or when the AbortController above fires after
      // REQUEST_TIMEOUT_MS — both are treated identically as "couldn't reach
      // the server", not as distinct cases. The DSM app's offline-first mode
      // (Section 15.3) applies to queuing *bill entries* once a shift is
      // underway — login itself always needs a live round trip to the
      // server, so we surface this distinctly rather than silently retrying
      // or pretending success. In practice during dev this is almost always
      // a misconfigured EXPO_PUBLIC_API_BASE_URL rather than a real network
      // outage, so the message points there directly.
      throw new PinLoginError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    // Treat the backend's response as authoritative — do not let the client
    // invent a different reason than what the server said. We surface the
    // server's own `message` field (e.g. "Invalid credentials") rather than
    // a client-invented fixed string, falling back to a generic message only
    // if the body can't be parsed as JSON.
    let message = 'Invalid phone number or PIN.';
    try {
      const body = (await response.json()) as { message?: string };
      if (typeof body.message === 'string' && body.message.length > 0) {
        message = body.message;
      }
    } catch {
      // Body wasn't valid JSON — fall back to the generic message above.
    }
    throw new PinLoginError(message);
  }

  return (await response.json()) as PinLoginResponse;
}
