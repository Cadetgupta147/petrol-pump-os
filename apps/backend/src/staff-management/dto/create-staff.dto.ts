import { IsEnum, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Matches, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

// Section 3.7 — Staff master: name, phone, PIN/login credential, role.
//
// pin/password are both optional here (not @ValidateIf-required) because
// which one is actually required depends on `role` — DSM staff log in with
// a PIN only (Staff.pinHash), every other role logs in with a password only
// (Staff.passwordHash), per the schema comment on Staff. That cross-field
// rule (and rejecting the WRONG credential for the role, not just requiring
// the right one) is enforced in StaffManagementService.create() rather than
// here, same pattern as BillsService's business-rule validation that isn't
// expressible via decorators alone.
export class CreateStaffDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsPhoneNumber('IN')
  phone!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'pin must be 4-8 digits' })
  pin?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
