import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { OmcBrand } from '@prisma/client';

// PATCH /business-profile — any subset of businessName/gstin/pumpLicenseNo/
// address/phone/omcBrand/useUploadedLetterhead. Section 3.9 / Section 5B.
// No format validation on gstin/pumpLicenseNo/phone (GSTIN has a real
// 15-character structured format, but validating it here would need a
// dedicated checksum/format rule this task doesn't have a spec for —
// flagged rather than half-implemented with a guessed regex).
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

  @IsOptional()
  @IsString()
  phone?: string;

  // Section 5B.2 — a label only (which OMC the dealer is affiliated with,
  // for the letterhead badge/heading text), never a logo — see logoImageData.
  @IsOptional()
  @IsEnum(OmcBrand)
  omcBrand?: OmcBrand;

  // Section 5B.2 — true = print statements onto the uploaded
  // letterheadImageData; false (default) = the software-generated header.
  @IsOptional()
  @IsBoolean()
  useUploadedLetterhead?: boolean;
}
