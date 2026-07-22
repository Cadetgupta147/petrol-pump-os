import { IsBoolean, IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

// Section 3.3 — DSM enters a closing meter reading at shift end; the
// backend auto-calculates litres sold = closing - opening (or, if the
// meter physically rolled over — see meterRolledOver below — (nozzle.
// rolloverAt - opening) + closing).
export class CloseShiftDto {
  @IsNumber()
  @Min(0)
  closingReading!: number;

  // Set true when this nozzle's meter physically reset to zero mid-shift
  // (older mechanical/electronic totalizers do this at a fixed digit
  // count). Only valid when closingReading < openingReading AND the
  // nozzle has a configured Nozzle.rolloverAt — see
  // MeterReadingsService.closeShift() for the exact validation and litres
  // calculation.
  @IsOptional()
  @IsBoolean()
  meterRolledOver?: boolean;

  // OPTIONAL and, like OpenShiftDto.shiftStart, only settable by a non-DSM
  // caller (assertNonDsmOverride()) — the manual-entry backdating fallback.
  // Omitted, it defaults to now(), same as before this existed.
  @IsOptional()
  @IsDateString()
  shiftEnd?: string;
}
