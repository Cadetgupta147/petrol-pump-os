import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomerDto } from './create-customer.dto';

// PATCH /customers/:id — any subset of name, phone, vehicleNumber, creditLimit.
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
