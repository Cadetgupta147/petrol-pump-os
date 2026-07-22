import { IsNumber, IsString, Min, MinLength } from 'class-validator';

// POST /nozzles — Section 3.3/4 Nozzle master setup ("Settings: how many
// nozzles/meters does this pump have"). Owner/Accountant only (see
// NozzlesController) — configuring the physical nozzle layout is a
// Settings-level action, not something a DSM does.
//
// label is the dealer's own naming (e.g. "N1", "P3") shown in every
// dropdown from here on. productType ties this nozzle to a Tank.productType,
// the same free-text convention Tank/OpenShiftDto already use (see
// CreateTankDto) rather than a hardcoded product enum, since dealers name
// grades differently (Petrol/MS, Diesel/HSD, Speed/Power, etc).
//
// startingReading is the ONE-TIME baseline for this nozzle's very first
// shift (e.g. onboarding an already-running pump whose meter isn't at
// zero) — see the schema comment on Nozzle.startingReading for why it's
// never read again after that first shift.
export class CreateNozzleDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  @MinLength(1)
  productType!: string;

  @IsNumber()
  @Min(0)
  startingReading!: number;
}
