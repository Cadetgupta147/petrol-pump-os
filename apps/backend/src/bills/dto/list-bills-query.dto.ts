import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PaymentType } from '@prisma/client';

// GET /bills?... — Section 3.2 bill register filters (date range, customer,
// DSM/staff, payment type, vehicle number, customer name, bill number) plus
// opt-in pagination. Every field is independently optional and combinable; a
// request with none of them preserves the pre-filter behavior (every
// non-deleted bill, unbounded) — see BillsService.findAll()'s comment for
// why that default is kept rather than silently capped.
export class ListBillsQueryDto {
  // Expected as YYYY-MM-DD, same convention as DateRangeQueryDto — but
  // unlike that shared DTO, from/to here are each independently optional
  // (a caller can filter by "everything after X" or "everything before Y"
  // alone), so the cross-field validator lives in BillsService instead.
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  // DSM/staff who entered the bill — named staffId (matches how the
  // register UI presents this filter, "DSM"), maps to Bill.enteredById.
  @IsOptional()
  @IsString()
  staffId?: string;

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  // Partial, case-insensitive match against Bill.vehicleNumber.
  @IsOptional()
  @IsString()
  vehicleNumber?: string;

  // Partial, case-insensitive match against Bill.customerName — the
  // free-typed name captured on the bill itself, which every entry point
  // (web portal, DSM app) populates whether or not the bill is linked to a
  // Customer, so this covers walk-ins and linked customers alike without a
  // second join.
  @IsOptional()
  @IsString()
  customerName?: string;

  // Partial, case-insensitive match against Bill.billNumber (e.g. "PUMP001-"
  // or just the sequence "000123") — lets a dealer search by the number
  // printed/shown on a bill instead of only by date/customer/vehicle.
  @IsOptional()
  @IsString()
  billNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
