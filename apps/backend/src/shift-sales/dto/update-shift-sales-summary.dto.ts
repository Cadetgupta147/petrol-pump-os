import { IsNumber, IsOptional, Min } from 'class-validator';

// Section 8A.2 — DSM/Owner/Accountant/Manager correction of the manually
// entered cash/card totals on an existing summary. walkInUpiCollected is
// DELIBERATELY not a field on this DTO — combined with the global
// ValidationPipe's `forbidNonWhitelisted: true` (see main.ts), a request
// that includes walkInUpiCollected is rejected outright (400) rather than
// silently stripped, so a human can never overwrite the webhook-populated
// UPI figure through this endpoint, whether by accident or otherwise.
export class UpdateShiftSalesSummaryDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  walkInCashCollected?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  walkInCardCollected?: number;
}
