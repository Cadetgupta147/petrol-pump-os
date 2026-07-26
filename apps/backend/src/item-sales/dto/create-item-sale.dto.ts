import { IsEnum, IsNumber, IsPositive, IsString } from 'class-validator';
import { PaymentType } from '@prisma/client';

// POST /item-sales — Lubricant/Urea-DEF sale. amount is deliberately NOT a
// DTO field: ItemSalesService computes it server-side as
// quantity * unitPrice, since (unlike PurchaseEntry, which reconciles
// against an externally-issued invoice that can legitimately round
// differently) there's no external document here to independently trust —
// accepting a client-supplied amount on a money-touching endpoint with no
// document to check it against would just be trusting the client's math.
// soldById is NOT a DTO field either — ItemSalesController derives it from
// req.user.staffId (Finding A1 pattern, docs/production-readiness.md).
export class CreateItemSaleDto {
  @IsString()
  itemId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsNumber()
  @IsPositive()
  unitPrice!: number;

  @IsEnum(PaymentType)
  paymentType!: PaymentType;
}
