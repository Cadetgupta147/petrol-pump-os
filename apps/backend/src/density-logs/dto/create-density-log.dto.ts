import { IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

// POST /density-logs — Section 7.3 (density/quality check), optionally
// linked to the delivery (purchaseEntryId) or physical stock check
// (dipReadingId) that prompted it. recordedById is taken as a body field
// rather than pulled off the JWT, matching CreateDipReadingDto's staffId
// convention for "who performed this physical action" fields.
export class CreateDensityLogDto {
  @IsString()
  tankId!: string;

  @IsNumber()
  @IsPositive()
  densityValue!: number;

  // Min(0), not IsPositive() — 0 ppm (no water/contaminant detected) is a
  // valid, in fact ideal, reading, not an invalid one.
  @IsOptional()
  @IsNumber()
  @Min(0)
  ppmValue?: number;

  @IsString()
  recordedById!: string;

  @IsOptional()
  @IsString()
  purchaseEntryId?: string;

  @IsOptional()
  @IsString()
  dipReadingId?: string;
}
