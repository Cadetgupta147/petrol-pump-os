import { IsOptional, IsString } from 'class-validator';

// Section 12 (staff attendance summary) / Section 4 ("PIN or biometric
// login... ties attendance... to a verifiable credential").
//
// Finding A1 (docs/production-readiness.md) — staffId is OPTIONAL and
// defaults to the authenticated caller when omitted (see
// resolveAssignableActorId(), used by AttendanceService.clockIn()). It can
// still be set to someone else — a Manager marking a DSM present who isn't
// the one submitting the request is a real flow — but only for non-DSM
// callers; a DSM submitting can only clock themselves in. Same
// assignable-field pattern as CreateCashCustodyLogDto.handledById /
// OpenShiftDto.staffId — see resolveAssignableActorId()'s header comment.
export class ClockInDto {
  @IsOptional()
  @IsString()
  staffId?: string;
}
