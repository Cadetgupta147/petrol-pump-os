import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CustomerVerificationStatus } from '@prisma/client';
import { CreateCustomerDto } from './create-customer.dto';

// PATCH /customers/:id — any subset of name, phone, vehicleNumber,
// creditLimit, verificationStatus.
//
// verificationStatus is deliberately NOT on CreateCustomerDto — the public
// POST /customers path is the normal fully-verified onboarding flow and
// always creates VERIFIED customers (schema default). This field only
// exists here as the "upgrade informal -> verified" path (Section 3.4A):
// an Owner/Accountant PATCHes in a phone + real creditLimit +
// verificationStatus: VERIFIED for a customer that was quick-added at bill
// time via BillsService's quickAddCustomer path.
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @IsOptional()
  @IsEnum(CustomerVerificationStatus)
  verificationStatus?: CustomerVerificationStatus;
}
