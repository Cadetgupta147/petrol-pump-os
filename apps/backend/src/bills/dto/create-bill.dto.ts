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
//
// Section 7.4 — rateApplied is deliberately NOT a field here. The server
// resolves it authoritatively from Rate Master (RateMasterService.
// getCurrentRate()) at bill-creation time — CLAUDE.md's "never trust the
// frontend" hard rule applies directly to money fields like this one, so the
// client no longer supplies a rate for create(). Contrast with
// UpdateBillDto, which still accepts a manual rateApplied — see the comment
// at BillsService.update() for why that asymmetry is intentional, not a gap.
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

  // Optional: which nozzle this bill was rung up against, if known. Not
  // required — most entry points don't send this yet (schema/backend
  // groundwork, see prisma/schema.prisma's comment on Bill.nozzleId) — but
  // when present, MeterReadingsService.checkVariance() matches bills to a
  // shift by this instead of the older staffId+time-window approximation,
  // which is exact instead of approximate.
  @IsOptional()
  @IsString()
  nozzleId?: string;

  @IsEnum(EntryChannel)
  entryChannel!: EntryChannel;

  @ValidateNested({ each: true })
  @Type(() => CreateBillPaymentLineDto)
  @ArrayMinSize(1)
  paymentLines!: CreateBillPaymentLineDto[];
}
