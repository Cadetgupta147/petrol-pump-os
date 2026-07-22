import { IsNumber, IsOptional, IsPositive, Min } from 'class-validator';

// POST /tanks/:id/dip-readings — Section 7.2 step 3 (daily physical DIP
// reading).
//
// Finding A1 (docs/production-readiness.md) — staffId is NOT a DTO field.
// A DIP reading is a direct physical measurement the caller either did or
// didn't do themselves — unlike CashCustodyLog.handledById/AttendanceLog.
// staffId, there's no legitimate "recording on behalf of someone else" flow
// here, so TanksController.recordDipReading() derives it unconditionally
// from req.user.staffId and passes it to TanksService as its own argument.
//
// Section 7.3 — densityValue/ppmValue are optional: a DIP check doesn't
// always come with an on-the-spot quality reading. When densityValue IS
// provided, the same actor staffId doubles as the recording staff for the
// linked DensityLog too — no duplicate field, see
// TanksService.recordDipReading().
export class CreateDipReadingDto {
  @IsNumber()
  @Min(0)
  reading!: number;

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
