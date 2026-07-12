import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsString } from 'class-validator';
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
}
