import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { PaymentType } from '@prisma/client';

// POST /customers/:customerId/payments — Section 3.4 "Record payment
// received (cash/UPI/bank transfer against dues)". CREDIT is deliberately
// excluded from the allowed methods: a repayment settled "with credit" is
// meaningless — see PaymentsService.
export class CreatePaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsIn([PaymentType.CASH, PaymentType.CARD, PaymentType.UPI])
  method!: typeof PaymentType.CASH | typeof PaymentType.CARD | typeof PaymentType.UPI;

  @IsOptional()
  @IsString()
  reference?: string;

  // Tally's "Agst Ref" — which specific credit bill this repayment settles.
  // Omitted/null = "On Account" (nets against the customer's aggregate
  // outstanding balance without closing any one bill in particular).
  @IsOptional()
  @IsString()
  billId?: string;
}
