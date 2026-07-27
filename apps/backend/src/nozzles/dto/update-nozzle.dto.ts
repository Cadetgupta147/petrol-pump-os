import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateNozzleDto } from './create-nozzle.dto';

// PATCH /nozzles/:id — any subset of label/itemId/tankId/startingReading/
// rolloverAt, plus isActive (soft-disable — see the schema comment on
// Nozzle.isActive; not on CreateNozzleDto since every nozzle starts
// active). PartialType only governs "which fields were sent" —
// NozzlesService.update() separately BLOCKS: a startingReading change once
// this nozzle has any MeterReading history, and an isActive:false change
// while this nozzle currently has an OPEN shift (see that method's
// comments for both).
//
// clearTank unlinks this nozzle from its Tank (back to the productType-
// string-match fallback) — a plain `tankId: undefined` in the PATCH body is
// indistinguishable from "not sent" (see NozzlesService.update()'s
// `dto.tankId !== undefined` checks), so unlinking needs its own explicit
// flag, same reasoning as every other boolean-gated field in this codebase.
export class UpdateNozzleDto extends PartialType(CreateNozzleDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  clearTank?: boolean;
}
