import { Type } from 'class-transformer';
import { ArrayMinSize, IsDateString, IsOptional, ValidateNested } from 'class-validator';
import { BatchCloseReadingDto } from './batch-close-reading.dto';

// POST /meter-readings/batch-close — Meter Reading redesign (Section 3.3).
// Replaces the old two-step "Open Shift" then "Close Shift" DSM flow: a DSM
// (or Owner/Accountant/Manager) now only ever enters CLOSING readings, for
// every active nozzle at once, in a single submission.
//
// There is deliberately no separate "open" request anymore — see
// MeterReadingsService.batchClose() for the auto-create-if-missing +
// auto-reopen-after-close mechanic that replaces it. shiftStart/shiftEnd
// stay real submission timestamps (now()) UNLESS backdated via shiftEnd
// below — exact clock-time precision doesn't matter here otherwise (see
// shift-schedule/resolve-current-shift-window.ts's own comment).
export class BatchCloseDto {
  @ValidateNested({ each: true })
  @Type(() => BatchCloseReadingDto)
  @ArrayMinSize(1)
  readings!: BatchCloseReadingDto[];

  // OPTIONAL, whole-batch backdating override — mirrors CloseShiftDto.
  // shiftEnd (Section 3.3.1 "Manual-entry backdating"), just applied to
  // every reading in this batch at once instead of a single nozzle: covers
  // "the DSM app was down / a day was missed, entering yesterday's closing
  // readings today." Only settable by a non-DSM caller
  // (assertNonDsmOverride() in MeterReadingsService.batchClose()) — a DSM
  // batch-closing their own live shift never backdates, same rule as the
  // single-nozzle fallback.
  @IsOptional()
  @IsDateString()
  shiftEnd?: string;
}
