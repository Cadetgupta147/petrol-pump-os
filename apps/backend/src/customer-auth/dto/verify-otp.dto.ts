import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { normalizePhoneTransformValue } from '../phone.util';

// requestId correlates this verify call back to the CustomerOtp row minted
// by RequestOtpDto's endpoint (matches apps/customer-app's assumed contract
// — see customerAuthApi.ts). otp is validated as exactly 6 numeric digits —
// same reasoning as RequestOtpDto: a malformed OTP shape never reaches the
// DB/bcrypt.compare, and format-only validation doesn't leak whether the
// requestId/phone pair is real.
//
// phone is normalized the same way as RequestOtpDto (see phone.util.ts) —
// verify() compares this against the phone stored on the CustomerOtp row
// (itself normalized at request time), so the two sides must use the exact
// same canonical form or every verify would spuriously fail with a phone
// entered in a different format than it was requested with.
export class VerifyOtpDto {
  @Transform(({ value }: { value: unknown }) => normalizePhoneTransformValue(value))
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Enter a valid 10-digit Indian mobile number',
  })
  phone!: string;

  @Matches(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  otp!: string;

  @IsString()
  @IsNotEmpty()
  requestId!: string;
}
