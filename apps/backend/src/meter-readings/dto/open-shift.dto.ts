import { IsOptional, IsString } from 'class-validator';

// Section 3.3/4 — DSM picks which nozzle they're starting a shift on from
// the Nozzle master dropdown (see nozzles.controller.ts's GET /nozzles) —
// nozzleId is a real Nozzle.id now, never a free-typed string.
//
// openingReading and productType are DELIBERATELY NOT on this DTO anymore:
// both are now SERVER-DERIVED in MeterReadingsService.openShift() (the
// carry-forward rule + Nozzle.productType). This closes the product gap
// directly — a DSM (or any caller) cannot set or edit the opening reading at
// shift start; if a client sends either field anyway, Nest's global
// ValidationPipe (forbidNonWhitelisted) rejects the request outright rather
// than silently ignoring it.
//
// Finding A1 (docs/production-readiness.md) — staffId is OPTIONAL and
// defaults to the authenticated caller when omitted (see
// resolveAssignableActorId(), used by MeterReadingsService.openShift()). It
// can still be set to someone else — a supervisor assigning a shift to a
// specific DSM operator is a real flow — but only for non-DSM callers; a
// DSM submitting can only open a shift for themselves. Same
// assignable-field pattern as CreateCashCustodyLogDto.handledById /
// ClockInDto.staffId — see resolveAssignableActorId()'s header comment.
export class OpenShiftDto {
  @IsString()
  nozzleId!: string;

  @IsOptional()
  @IsString()
  staffId?: string;
}
