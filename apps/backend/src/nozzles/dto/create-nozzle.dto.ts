import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

// POST /nozzles — Section 3.3/4 Nozzle master setup ("Settings: how many
// nozzles/meters does this pump have"). Owner/Accountant only (see
// NozzlesController) — configuring the physical nozzle layout is a
// Settings-level action, not something a DSM does.
//
// label is the dealer's own naming (e.g. "N1", "P3") shown in every
// dropdown from here on. itemId ties this nozzle to an Item Master row
// (Petrol/Diesel/Speed/etc, see items module) — replaces the old free-text
// productType field so a nozzle can no longer be mis-typed to a product
// that doesn't match any Tank/Item.
//
// startingReading is the ONE-TIME baseline for this nozzle's very first
// shift (e.g. onboarding an already-running pump whose meter isn't at
// zero) — see the schema comment on Nozzle.startingReading for why it's
// never read again after that first shift.
//
// rolloverAt is optional: only set it for a nozzle whose physical meter
// actually rolls over to zero at a fixed digit count. Leaving it unset (the
// common case for modern electronic totalizers) keeps closeShift()'s
// existing hard block on closingReading < openingReading.
export class CreateNozzleDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  itemId!: string;

  @IsNumber()
  @Min(0)
  startingReading!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rolloverAt?: number;
}
