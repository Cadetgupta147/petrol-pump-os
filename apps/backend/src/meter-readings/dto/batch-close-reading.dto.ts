import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// One nozzle's entry within POST /meter-readings/batch-close — see
// BatchCloseDto's comment for the overall shape.
//
// staffId is OPTIONAL and resolved via resolveAssignableActorId() exactly
// like OpenShiftDto/CloseShiftDto's own staffId field: omitted -> the
// caller; explicitly set to someone else -> allowed for non-DSM callers
// only. Deliberately kept PER-ROW (not once for the whole batch) — staff
// rotate across nozzles, so a fixed one-batch-one-staffId assumption
// wouldn't hold, and attributing every nozzle to whoever happened to submit
// would blur the exact accountability the meter-vs-billed variance flag
// exists to catch.
export class BatchCloseReadingDto {
  @IsString()
  nozzleId!: string;

  @IsNumber()
  @Min(0)
  closingReading!: number;

  @IsOptional()
  @IsBoolean()
  meterRolledOver?: boolean;

  @IsOptional()
  @IsString()
  staffId?: string;
}
