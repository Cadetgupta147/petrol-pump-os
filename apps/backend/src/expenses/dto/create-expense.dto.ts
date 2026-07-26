import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { PaymentType } from '@prisma/client';

// POST /expenses — dashboard "Today's expenses" slice. category is a free
// string (no typed enum exists here, same convention as Bill/Tank/
// PurchaseEntry.productType). recordedById is NOT a DTO field — see
// ExpensesController, which derives it from req.user.staffId (Finding A1
// pattern, docs/production-readiness.md).
export class CreateExpenseDto {
  @IsString()
  category!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(PaymentType)
  paidVia!: PaymentType;

  // Defaults to now() at the DB level when omitted — only set explicitly for
  // a backdated/late entry (e.g. entering yesterday's fuel-tanker receipt).
  @IsOptional()
  @IsDateString()
  expenseDate?: string;
}
