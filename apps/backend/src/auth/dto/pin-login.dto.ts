import { IsNotEmpty, IsString } from 'class-validator';

// DSM app PIN login (Section 4). Login identifier is Staff.phone, same as
// LoginDto. Not using a stricter format/length validator on `pin` for the
// same reason LoginDto avoids @IsPhoneNumber — a validation error would let
// a caller distinguish "malformed" from "wrong", instead of the intended
// uniform 401 "invalid credentials".
export class PinLoginDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  pin!: string;
}
