import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateNozzleDto } from './create-nozzle.dto';

// PATCH /nozzles/:id — any subset of label/itemId/startingReading/
// rolloverAt, plus isActive (soft-disable — see the schema comment on
// Nozzle.isActive; not on CreateNozzleDto since every nozzle starts
// active). PartialType only governs "which fields were sent" —
// NozzlesService.update() separately BLOCKS: a startingReading change once
// this nozzle has any MeterReading history, and an isActive:false change
// while this nozzle currently has an OPEN shift (see that method's
// comments for both).
export class UpdateNozzleDto extends PartialType(CreateNozzleDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
