import { IsNotEmpty, IsString } from 'class-validator';

// Section 3.4A — inline quick-add of an informal credit customer at the
// moment of billing: name + vehicle number only, no phone, no manual credit
// limit (the limit is auto-applied from CreditConfig.defaultInformalCreditLimit).
export class QuickAddCustomerDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  vehicleNumber!: string;
}
