import { IsBoolean, IsEnum, IsNumber, IsOptional, IsPhoneNumber, IsPositive, IsString, Matches, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

// Section 3.7 edit — name/phone/active toggle/role, plus resetting whichever
// credential the EFFECTIVE role (after any role change in this same request)
// uses (pin for DSM, password for everyone else).
//
// Role USED TO be non-editable here, flagged as a real scope gap rather than
// silently guessed: a role change also changes which credential type is
// valid (DSM logs in with a pin only; every other role with a password
// only), and nothing in Section 3.7 specified what should happen to an
// existing pin/passwordHash when that happened. That gap is now resolved in
// StaffManagementService.update(): the pin/password-vs-role validation there
// checks against `dto.role ?? existing.role` (the role that will be in
// effect AFTER this update), not the stale pre-update role, and whenever
// `dto.role` crosses the DSM <-> non-DSM boundary the caller is REQUIRED to
// supply the new credential type in the same request (moving TO DSM needs a
// new `pin`; moving AWAY FROM DSM needs a new `password`) — the now-invalid
// old credential field is nulled out server-side rather than left stale on
// the account. See that method's comment for the full rule. A role change
// that does NOT cross that boundary (e.g. OWNER -> ACCOUNTANT) needs no
// forced credential reset; existing optional pin/password reset behavior
// applies unchanged.
export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsPhoneNumber('IN')
  phone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // See class comment above for the credential-type-boundary handling this
  // triggers server-side — this DTO only validates that the value is a real
  // Role, the actual enforcement lives in StaffManagementService.update().
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'pin must be 4-8 digits' })
  pin?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  // Section 17.23 — fixed monthly salary. Owner-only, same as every other
  // field on this DTO (see the class comment on why this whole surface is
  // Owner-only rather than gating just the credential fields).
  @IsOptional()
  @IsNumber()
  @IsPositive()
  monthlySalary?: number;
}
