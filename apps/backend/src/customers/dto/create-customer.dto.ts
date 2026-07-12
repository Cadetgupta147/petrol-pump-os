import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Min,
} from 'class-validator';

// Section 3.4 — Customer master: name, phone, vehicle number(s), credit limit.
// `phone` is the KYC-lite identity (Customer.phone is @unique in the schema).
export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  // 'IN' region hint keeps this reasonably strict without hardcoding a regex;
  // revisit if the pump ever needs to onboard customers with non-Indian numbers.
  @IsPhoneNumber('IN')
  phone!: string;

  @IsOptional()
  @IsString()
  vehicleNumber?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number;
}
