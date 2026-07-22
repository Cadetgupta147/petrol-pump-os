import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Section 3.3 — DSM enters an opening meter reading for a nozzle at shift
// start. shiftStart itself is not client-supplied — it defaults to now()
// via the Prisma schema default.
//
// Finding A1 (docs/production-readiness.md) — staffId is OPTIONAL and
// defaults to the authenticated caller when omitted (see
// resolveAssignableActorId(), used by MeterReadingsService.openShift()). It
// can still be set to someone else — a supervisor assigning a shift to a
// specific DSM operator is a real flow — but only for non-DSM callers; a
// DSM submitting can only open a shift for themselves. Same
// assignable-field pattern as CreateCashCustodyLogDto.handledById /
// ClockInDto.staffId — see resolveAssignableActorId()'s header comment.
//
// Section 7.2 — productType is required (non-optional) for every new shift
// going forward, so closeShift() can resolve which Tank to auto-deduct. It's
// nullable on the MeterReading model itself only so existing (legacy) rows
// don't need a migration backfill — see the schema comment on
// MeterReading.productType.
export class OpenShiftDto {
  @IsString()
  nozzleId!: string;

  @IsOptional()
  @IsString()
  staffId?: string;

  @IsNumber()
  @Min(0)
  openingReading!: number;

  @IsString()
  productType!: string;
}
