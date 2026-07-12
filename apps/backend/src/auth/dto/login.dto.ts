import { IsNotEmpty, IsString } from 'class-validator';

// Login identifier is Staff.phone (doubles as the login identifier — see
// prisma/schema.prisma Staff model comment). Not using @IsPhoneNumber here
// since it'd reject a malformed login attempt with a validation error
// instead of the intended 401 "invalid credentials" — bad input should look
// the same as wrong input to a caller probing for valid phone numbers.
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
