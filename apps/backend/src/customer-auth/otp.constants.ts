// Tunables for Section 5's phone+OTP login. These are reasonable defaults,
// not a spec requirement from docs/master-plan.md (which doesn't mention
// OTP length/expiry/rate-limit policy at all) — flagged for human review,
// same as the rest of this slice.

// How long a freshly-requested OTP stays valid. Also doubles as the
// client's resend-cooldown timer (apps/customer-app's OtpEntryScreen counts
// down `expiresInSeconds` and only re-enables "Resend OTP" once it hits
// zero) — enforced server-side too, see CustomerAuthService.requestOtp.
export const OTP_TTL_SECONDS = 5 * 60;

// A phone number can have at most one *live* (unexpired, unconsumed) OTP at
// a time — requesting again before that window elapses is rejected (429).
// This alone caps resend frequency; the cap below additionally limits total
// requests per phone even across many expiry cycles (e.g. an attacker who
// waits out each expiry and immediately re-requests).
export const MAX_OTP_REQUESTS_PER_PHONE_PER_WINDOW = 5;
export const OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour

// Failed verify attempts allowed against a single OTP row before it's
// locked out (consumedAt set, forcing a fresh request).
export const MAX_OTP_VERIFY_ATTEMPTS = 5;

// Per-IP request throttling (in addition to the per-phone limits above) —
// see CustomerAuthController's @Throttle() usage. Deliberately looser than
// the per-phone cap since one IP (e.g. an office Wi-Fi, or a shared
// customer-facing kiosk) may legitimately serve several different phone
// numbers.
export const OTP_REQUEST_IP_THROTTLE_LIMIT = 15;
export const OTP_VERIFY_IP_THROTTLE_LIMIT = 30;
export const OTP_IP_THROTTLE_TTL_MS = 60 * 1000;
