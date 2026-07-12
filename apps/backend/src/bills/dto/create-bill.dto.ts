import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { EntryChannel } from '@prisma/client';
import { CreateBillPaymentLineDto } from './create-bill-payment-line.dto';
import { QuickAddCustomerDto } from './quick-add-customer.dto';

// Section 3.2 (manual bill entry, web/DSM parity) + Section 5A (split payments)
// + Section 3.4A (informal quick-add customer at bill time).
//
// Bill-level validation NOT expressible via decorators alone lives in
// BillsService.create():
//   - Section 4: at least one of vehicleNumber / customerName must be present.
//   - Section 5A.1: sum(IN) - sum(OUT) across paymentLines must equal `amount`.
//   - customerId, if provided, must reference an existing Customer.
//   - customerId and quickAddCustomer are mutually exclusive.
//   - quickAddCustomer is only valid alongside at least one CREDIT payment line.
export class CreateBillDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  // Section 3.4A — inline quick-add of an informal credit customer. Mutually
  // exclusive with customerId; only meaningful when the bill has a CREDIT
  // payment line (see BillsService.create()).
  @IsOptional()
  @ValidateNested()
  @Type(() => QuickAddCustomerDto)
  quickAddCustomer?: QuickAddCustomerDto;

  @IsOptional()
  @IsString()
  vehicleNumber?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsNumber()
  @IsPositive()
  litres!: number;

  @IsString()
  productType!: string;

  @IsNumber()
  @IsPositive()
  rateApplied!: number;

  @IsString()
  enteredById!: string;

  @IsEnum(EntryChannel)
  entryChannel!: EntryChannel;

  @ValidateNested({ each: true })
  @Type(() => CreateBillPaymentLineDto)
  @ArrayMinSize(1)
  paymentLines!: CreateBillPaymentLineDto[];
}
