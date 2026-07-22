import { IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

// POST /density-logs — Section 7.3 (density/quality check), optionally
// linked to the delivery (purchaseEntryId) or physical stock check
// (dipReadingId) that prompted it.
//
// Finding A1 (docs/production-readiness.md) — recordedById is NOT a DTO
// field. Same reasoning as CreateDipReadingDto: a density/quality reading
// is a direct physical measurement, so DensityLogsController.create()
// derives the actor unconditionally from req.user.staffId.
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

  @IsOptional()
  @IsString()
  purchaseEntryId?: string;

  @IsOptional()
  @IsString()
  dipReadingId?: string;
}
