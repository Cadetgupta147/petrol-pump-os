import { IsNumber, IsOptional, Min } from 'class-validator';

// PATCH /meter-readings/:id/correct — Owner/Accountant only. Corrects a
// reading's opening/closing value after the fact (Section 3.3's "manual
// entry option ... for corrections", which had no actual edit path before
// this endpoint existed — open/close were the only two writes available).
//
// See MeterReadingsService.correctMeterReading() for the exact rules:
//   - openingReading is only correctable on a nozzle's chronologically
//     FIRST-EVER reading — every later shift's opening reading is
//     carry-forward derived from the previous shift's closingReading, not
//     independently editable (correct THAT shift's closingReading instead).
//   - closingReading is only correctable on an already-closed reading
//     (an open shift has no closing reading yet — use PATCH .../close), and
//     is blocked if a chronologically later shift on the same nozzle is
//     ALSO already closed, to avoid an unbounded correction cascade — fix
//     the chain starting from its earliest wrong point instead.
//   - Correcting closingReading adjusts the matching Tank's stock by the
//     delta between the old and new litresSold, and — if the immediate
//     next shift on this nozzle is still open — updates that shift's
//     openingReading to match, keeping the carry-forward chain consistent.
export class CorrectMeterReadingDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  openingReading?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  closingReading?: number;
}
