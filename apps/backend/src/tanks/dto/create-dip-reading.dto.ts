import { IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

// POST /tanks/:id/dip-readings — Section 7.2 step 3 (daily physical DIP
// reading). staffId is taken as a body field rather than pulled off the JWT,
// matching OpenShiftDto's existing convention for "who performed this
// physical action" fields in this codebase.
//
// Section 7.3 — densityValue/ppmValue are optional: a DIP check doesn't
// always come with an on-the-spot quality reading. When densityValue IS
// provided, staffId doubles as the recording staff for the linked
// DensityLog too — no duplicate field, see TanksService.recordDipReading().
export class CreateDipReadingDto {
  @IsNumber()
  @Min(0)
  reading!: number;

  @IsString()
  staffId!: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  densityValue?: number;

  // Min(0), not IsPositive() — 0 ppm is a valid, ideal reading (see the same
  // note on CreateDensityLogDto.ppmValue).
  @IsOptional()
  @IsNumber()
  @Min(0)
  ppmValue?: number;
}
