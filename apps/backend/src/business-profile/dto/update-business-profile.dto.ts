import { IsOptional, IsString } from 'class-validator';

// PATCH /business-profile — any subset of businessName/gstin/pumpLicenseNo/
// address. Section 3.9. No format validation on gstin/pumpLicenseNo
// (GSTIN has a real 15-character structured format, but validating it here
// would need a dedicated checksum/format rule this task doesn't have a spec
// for — flagged rather than half-implemented with a guessed regex).
export class UpdateBusinessProfileDto {
  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsOptional()
  @IsString()
  pumpLicenseNo?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
