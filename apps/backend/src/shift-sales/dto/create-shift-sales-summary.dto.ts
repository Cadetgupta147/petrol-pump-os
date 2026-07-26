import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Section 8A.2 — creates the walk-in aggregate summary for a shift once it's
// closed (shiftId === the MeterReading's id — a shift and its MeterReading
// are the same row, see meter-readings). walkInLitres/expectedValue are
// SERVER-COMPUTED (from the shift's meter reading + Rate Master), never
// client-supplied — only the manually-entered cash/card totals come from the
// caller. walkInUpiCollected is ONLY accepted from the client when this
// pump's UpiCaptureConfig has autoCaptureEnabled=false — see
// ShiftSalesService.create(), which rejects it otherwise (Section 8A.3: the
// webhook is the sole writer once auto-capture is on).
export class CreateShiftSalesSummaryDto {
  @IsString()
  shiftId!: string;

  // Denormalized convenience fields matching the ShiftSalesSummary schema
  // (dsmId/nozzleId aren't FKs) — optional because both can be derived from
  // the shiftId's MeterReading row if omitted.
  @IsOptional()
  @IsString()
  dsmId?: string;

  @IsOptional()
  @IsString()
  nozzleId?: string;

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
