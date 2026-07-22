import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateNozzleDto } from './create-nozzle.dto';

// PATCH /nozzles/:id — any subset of label/productType/startingReading, plus
// isActive (soft-disable once a nozzle has reading history — see the schema
// comment on Nozzle.isActive; not on CreateNozzleDto since every nozzle
// starts active). PartialType only governs "which fields were sent" —
// NozzlesService.update() separately BLOCKS a startingReading change once
// this nozzle has any MeterReading history (see that method's comment).
export class UpdateNozzleDto extends PartialType(CreateNozzleDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
