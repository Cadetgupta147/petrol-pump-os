import { IsNumber, IsOptional, Min } from 'class-validator';

// Section 8A.2 — DSM/Owner/Accountant/Manager correction of the manually
// entered cash/card totals on an existing summary. walkInUpiCollected is
// ONLY accepted when this pump's UpiCaptureConfig has
// autoCaptureEnabled=false — see ShiftSalesService.update(), which rejects
// a client-supplied value otherwise (400), so a human can never overwrite
// the webhook-populated UPI figure once auto-capture is on, whether by
// accident or otherwise.
export class UpdateShiftSalesSummaryDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  walkInCashCollected?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  walkInCardCollected?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  walkInUpiCollected?: number;
}
