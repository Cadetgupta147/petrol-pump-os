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

  // Fleet/company this vehicle bills under, if any — dealer-set only, used
  // for Section 3.4B's company-scope blacklisting and reporting. Carries no
  // enforcement meaning by itself.
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number;
}
