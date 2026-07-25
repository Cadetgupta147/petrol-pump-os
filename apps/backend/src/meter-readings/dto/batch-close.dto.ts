import { Type } from 'class-transformer';
import { ArrayMinSize, ValidateNested } from 'class-validator';
import { BatchCloseReadingDto } from './batch-close-reading.dto';

// POST /meter-readings/batch-close — Meter Reading redesign (Section 3.3).
// Replaces the old two-step "Open Shift" then "Close Shift" DSM flow: a DSM
// (or Owner/Accountant/Manager) now only ever enters CLOSING readings, for
// every active nozzle at once, in a single submission.
//
// There is deliberately no separate "open" request anymore — see
// MeterReadingsService.batchClose() for the auto-create-if-missing +
// auto-reopen-after-close mechanic that replaces it. shiftStart/shiftEnd
// stay real submission timestamps (now()), never forced to any configured
// shift-schedule boundary — exact clock-time precision doesn't matter here
// (see shift-schedule/resolve-current-shift-window.ts's own comment).
export class BatchCloseDto {
  @ValidateNested({ each: true })
  @Type(() => BatchCloseReadingDto)
  @ArrayMinSize(1)
  readings!: BatchCloseReadingDto[];
}
