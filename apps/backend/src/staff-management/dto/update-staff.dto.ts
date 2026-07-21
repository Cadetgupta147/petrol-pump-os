import { IsBoolean, IsOptional, IsPhoneNumber, IsString, Matches, MinLength } from 'class-validator';

// Section 3.7 edit — name/phone/active toggle, plus resetting whichever
// credential this staff member's EXISTING role uses (pin for DSM, password
// for everyone else). Role itself is deliberately NOT editable here — a
// role change would also change which credential type is valid, and
// nothing in Section 3.7 specifies what should happen to an existing
// pin/passwordHash when that happens. Flagged as a real scope gap (not
// silently guessed) rather than built on an assumption; deactivating and
// re-creating a staff member with the correct role is the fallback until
// this gets a real spec.
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

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'pin must be 4-8 digits' })
  pin?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
