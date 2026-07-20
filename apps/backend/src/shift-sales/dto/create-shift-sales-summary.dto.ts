import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Section 8A.2 — creates the walk-in aggregate summary for a shift once it's
// closed (shiftId === the MeterReading's id — a shift and its MeterReading
// are the same row, see meter-readings). walkInLitres/expectedValue are
// SERVER-COMPUTED (from the shift's meter reading + Rate Master), never
// client-supplied — only the manually-entered cash/card totals come from the
// caller. walkInUpiCollected is deliberately NOT part of this DTO: it starts
// at 0 and is only ever incremented later by the UPI webhook handler (see
// upi-webhook/) — see ShiftSalesService.create() for why.
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
}
