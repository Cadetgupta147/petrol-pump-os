// Normalizes a phone number to bare 10-digit Indian mobile form BEFORE any
// validation, rate-limiting, or Customer lookup touches it (Section 5).
//
// Without this, "9876543210", "+919876543210", and "919876543210" would be
// treated as three DIFFERENT phone numbers by the per-phone OTP rate
// limiter (CustomerAuthService.requestOtp queries CustomerOtp by exact
// `phone` string match) — trivially defeating the rate limit by just
// re-formatting the same real-world number on each call.
//
// Strips everything but digits, then strips a leading "91" country-code
// prefix IFF the result is exactly 12 digits. Length is what disambiguates
// "91 is a country-code prefix" from "91 is just the start of the real
// number" — a bare 10-digit Indian mobile number can itself start with 9
// (e.g. 98xxxxxxxx), so a 10-digit result is never touched.
export function normalizeIndianMobile(input: string): string {
  const digitsOnly = input.replace(/\D/g, '');
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return digitsOnly.slice(2);
  }
  return digitsOnly;
}

// class-transformer's @Transform callback receives `value: any` (it's typed
// that way upstream in the library, not something we control) — this
// wrapper gives call sites in the DTOs a properly-typed (`unknown` in,
// `unknown` out) function so `@typescript-eslint/no-unsafe-return` doesn't
// flag the DTOs themselves for propagating that `any`.
export function normalizePhoneTransformValue(value: unknown): unknown {
  return typeof value === 'string' ? normalizeIndianMobile(value) : value;
}
