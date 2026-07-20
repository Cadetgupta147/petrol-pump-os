import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { normalizePhoneTransformValue } from '../phone.util';

// Section 5 — "Login via phone number + OTP." 10-digit Indian mobile number,
// first digit 6-9: matches the format apps/customer-app's PhoneEntryScreen
// already validates client-side (INDIAN_MOBILE_REGEX) and the convention
// already used for Staff.phone elsewhere in this codebase. Not specified by
// docs/master-plan.md Section 5 itself (which only says "phone number +
// OTP") — see the confirmation/pushback note in this slice's summary.
//
// Unlike LoginDto/PinLoginDto (which deliberately skip format validation to
// avoid distinguishing "malformed" from "wrong" in an enumeration-sensitive
// login flow), rejecting a malformed phone here with a plain 400 is safe:
// no OTP/SMS send is triggered either way, and phone *format* validity
// reveals nothing about whether an account exists behind that number.
//
// @Transform runs BEFORE @Matches (ValidationPipe's `transform: true` in
// main.ts applies class-transformer's plainToInstance step first, then
// validates the resulting instance) — so "+919876543210" / "919876543210" /
// "9876543210" all collapse to the same bare 10-digit value before either
// the format check or (downstream, in the service) the rate-limit/lookup
// queries ever see it. Without this, per-phone rate limiting could be
// trivially bypassed by re-formatting the same real number on each call.
export class RequestOtpDto {
  @Transform(({ value }: { value: unknown }) => normalizePhoneTransformValue(value))
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Enter a valid 10-digit Indian mobile number',
  })
  phone!: string;
}
