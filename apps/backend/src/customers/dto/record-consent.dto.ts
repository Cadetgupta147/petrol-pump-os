import { IsString } from 'class-validator';

// PATCH /customers/:id/consent — Section 17.11 (DPDP Act compliance
// scaffolding). `version` identifies which privacy-policy/consent-notice
// text the customer actually saw — a free-form string, not validated
// against anything here, since this codebase has no privacy-policy content
// management of its own (see BusinessProfile — no such field exists yet).
export class RecordConsentDto {
  @IsString()
  version!: string;
}
