import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { CreateBillDto } from './create-bill.dto';

// PATCH /bills/:id — any subset of vehicleNumber, customerName, amount,
// litres, productType, rateApplied, customerId, paymentLines.
//
// enteredById and entryChannel record original attribution and must stay
// immutable after creation — omitted from what's editable here.
//
// paymentLines, if provided, is a FULL REPLACEMENT of the bill's existing
// payment lines (not a merge/patch of individual lines) — see
// BillsService.update().
class EditableCreateBillDto extends OmitType(CreateBillDto, [
  'enteredById',
  'entryChannel',
] as const) {}

export class UpdateBillDto extends PartialType(EditableCreateBillDto) {
  // Who is performing this edit — no auth yet, so the actor must be passed
  // explicitly, same pattern as enteredById on create / deletedById on delete.
  @IsString()
  editedById!: string;

  // Section 7.4 — rateApplied is NOT on CreateBillDto anymore (the server
  // resolves it authoritatively from Rate Master at create() time — see that
  // DTO's comment), so it doesn't come along via EditableCreateBillDto and
  // must be declared here explicitly. Editing an existing bill is staff
  // correcting a specific, already-recorded sale (e.g. fixing a data-entry
  // mistake) — a different concern from initial capture-at-sale-time, where
  // trusting a client-supplied rate would be a real fraud/error vector. This
  // asymmetry is deliberate: don't "fix" it by either making create() accept
  // a manual rate again, or by making update() re-resolve from Rate Master.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  rateApplied?: number;
}
