import { IsEnum, IsNumber, IsPositive } from 'class-validator';
import { PaymentDirection, PaymentType } from '@prisma/client';

// Section 5A.1 — one line of a bill's payment breakdown.
// `direction: IN` = money received, `OUT` = change handed back to the customer.
export class CreateBillPaymentLineDto {
  @IsEnum(PaymentType)
  paymentType!: PaymentType;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(PaymentDirection)
  direction!: PaymentDirection;
}
