import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

// POST /customers/:id/opening-balance — Section 3.4. Records a pre-existing
// balance for a customer being onboarded from before this system was used.
// amount is deliberately NOT @IsPositive(): positive = customer owed this
// much as of effectiveAt, negative = a correcting entry against a prior
// mistake (see CustomerOpeningBalance's schema comment) — zero is rejected
// in the service instead, since it's not a validation shape decorators
// alone can express as "non-zero".
export class CreateOpeningBalanceDto {
  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;

  // Backdatable — "as of the day we started using this system". Defaults to
  // now() in the service when omitted.
  @IsOptional()
  @IsDateString()
  effectiveAt?: string;
}
