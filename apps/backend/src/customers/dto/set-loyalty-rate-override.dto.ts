import { IsNumber, Min, ValidateIf } from 'class-validator';

// PATCH /customers/:id/loyalty-rate-override — Section 6.2 per-customer
// override of the dealer's default earning rate. Owner-only (Section 2:
// "Accountant cannot change loyalty rates"), which is why this is its own
// route instead of a field on UpdateCustomerDto (that PATCH is
// Owner+Accountant).
//
// The field is required: a number sets the override (0 is valid — "this
// customer earns nothing"), an explicit null clears it so the customer goes
// back to the dealer default.
export class SetLoyaltyRateOverrideDto {
  @ValidateIf(
    (dto: SetLoyaltyRateOverrideDto) => dto.loyaltyRateOverride !== null,
  )
  @IsNumber()
  @Min(0)
  loyaltyRateOverride!: number | null;
}
