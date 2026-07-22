import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateItemDto } from './create-item.dto';

// PATCH /items/:id — any subset of name/category/unit, plus isActive
// (soft-disable — see ItemsService.update()'s comment on why an item that's
// referenced by any Nozzle can't be fully deleted, only disabled).
export class UpdateItemDto extends PartialType(CreateItemDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
