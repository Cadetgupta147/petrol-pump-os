import { API_BASE_URL } from '../config';

// ============================================================================
// ASSUMED BACKEND CONTRACT — NOT YET IMPLEMENTED ON THE BACKEND.
// ============================================================================
// docs/master-plan.md Section 5 specifies only "Login via phone number + OTP
// — No password to remember, no heavy signup" for the Credit Customer App.
// It does NOT specify: the OTP delivery mechanism/provider, OTP length,
// expiry window, resend/rate-limit policy, or the session/token shape for
// customers (as opposed to Staff, whose JWT auth already exists in
// apps/backend/src/auth). None of these are decided anywhere else in
// docs/master-plan.md either — Section 17's open items list an SMS gateway
// only in the context of the *notification* fallback (Section 11), not as
// the login-OTP delivery channel, and no OTP provider is named.
//
// This is flagged as a gap for a human/backend-agent decision, not guessed.
// The shape below is a reasonable placeholder client-side contract, built by
// analogy to the existing POST /auth/pin-login pattern (auth.controller.ts,
// PinLoginDto) and the Staff JWT issued by AuthService, so mobile work isn't
// blocked — but every endpoint here 404s against the current backend. Do NOT
// treat this as an API contract to build against; coordinate with
// backend-agent before implementing the real endpoints, since they also
// require:
//   - A new persistent OTP record (phone, code hash, expiry, attempt count) —
//     a Prisma schema change, which is backend-agent's territory, not this
//     app's.
//   - A customer-scoped JWT strategy/guard distinct from the existing
//     Staff-only JwtStrategy (a customer token must never be usable against
//     staff-only endpoints, and vice versa).
//   - Actual OTP delivery (SMS gateway / Firebase Phone Auth / WhatsApp OTP —
//     provider undecided, see .env.example placeholders).
//   - Server-side rate limiting on both request + verify (a client-side resend
//     cooldown, implemented in OtpEntryScreen, is a UX nicety only and is not
//     a substitute for this — CLAUDE.md: never trust the frontend to enforce
//     a security control).

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string;
  // Section 6.1 — the QR pointer id. Included here purely as a profile field
  // pulled from the Customer record on successful login, same as the DSM
  // app's StaffSummary carries staff.phone/role — this is NOT the QR payload
  // itself and nothing here ever carries a points balance or rate (Section
  // 6.1/6.7 — the app must never store/display balance from anywhere but a
  // dedicated, explicitly-authenticated balance endpoint, not from login).
  qrMemberId: string;
  vehicleNumber: string | null;
}

export interface RequestOtpResponse {
  // Opaque handle correlating a request → verify call, in case a phone
  // number has more than one outstanding OTP (e.g. resend). Assumed shape —
  // see file header.
  requestId: string;
  expiresInSeconds: number;
}

export interface VerifyOtpResponse {
  accessToken: string;
  customer: CustomerSummary;
}

export class CustomerAuthError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      // Network failure or timeout — see PinLoginError's identical reasoning
      // in apps/dsm-app/src/api/authApi.ts. Login (unlike offline bill entry,
      // Section 15.3) always needs a live round trip; there is no queued/
      // offline login.
      throw new CustomerAuthError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = 'Something went wrong. Please try again.';
    try {
      const errBody = (await response.json()) as { message?: string };
      if (typeof errBody.message === 'string' && errBody.message.length > 0) {
        message = errBody.message;
      }
    } catch {
      // Body wasn't valid JSON — fall back to the generic message above.
    }
    throw new CustomerAuthError(message);
  }

  return (await response.json()) as T;
}

// Assumed: POST /auth/customer/otp/request { phone } — NOT YET IMPLEMENTED.
export async function requestOtp(phone: string): Promise<RequestOtpResponse> {
  return postJson<RequestOtpResponse>('/auth/customer/otp/request', { phone });
}

// Assumed: POST /auth/customer/otp/verify { phone, otp, requestId } — NOT YET
// IMPLEMENTED.
export async function verifyOtp(
  phone: string,
  otp: string,
  requestId: string,
): Promise<VerifyOtpResponse> {
  return postJson<VerifyOtpResponse>('/auth/customer/otp/verify', { phone, otp, requestId });
}
