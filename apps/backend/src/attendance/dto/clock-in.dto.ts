import { IsString } from 'class-validator';

// Section 12 (staff attendance summary) / Section 4 ("PIN or biometric
// login... ties attendance... to a verifiable credential"). staffId is
// client-supplied here, same convention as OpenShiftDto/CreateCashCustodyLogDto
// elsewhere in this codebase (validated via the Staff FK constraint at
// write time, not derived from the web-portal JWT) — kept consistent with
// the rest of this codebase rather than introducing a new
// self-service-only auth pattern for just this one module.
export class ClockInDto {
  @IsString()
  staffId!: string;
}
