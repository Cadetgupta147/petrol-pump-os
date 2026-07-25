import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateShiftDefinitionDto } from './create-shift-definition.dto';

// PATCH /shift-schedule/:id — any subset of label/startTime/endTime, plus
// isActive (soft-disable — every shift definition starts active, same
// pattern as UpdateNozzleDto).
export class UpdateShiftDefinitionDto extends PartialType(CreateShiftDefinitionDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
