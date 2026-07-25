import { IsString, Matches, MinLength } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// POST /shift-schedule — Meter Reading redesign (Section 3.3). Owner/
// Accountant only (see shift-schedule.controller.ts) — a dealer-chosen label
// (e.g. "Shift 1") plus a wall-clock start/end time-of-day ("HH:mm", 24h, no
// date or timezone). endTime may be numerically "before" startTime to
// represent a shift that wraps past midnight (e.g. "22:00"-"06:00") — see
// resolve-current-shift-window.ts for how that's resolved.
//
// Deliberately NO overlap/gap validation here: this schedule only ever
// LABELS which shift a batch-closing-readings submission belongs to (see
// MeterReadingsService.batchClose()) — it is never used to validate or
// block a submission, so enforcing non-overlap would turn an advisory
// display feature into a blocking one, which the product decision behind
// this redesign explicitly rejected.
export class CreateShiftDefinitionDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime must be in 24h "HH:mm" format' })
  startTime!: string;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'endTime must be in 24h "HH:mm" format' })
  endTime!: string;
}
