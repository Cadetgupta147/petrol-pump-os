import { IsEnum, IsString, MinLength } from 'class-validator';
import { ItemCategory, ItemUnit } from '@prisma/client';

// POST /items — Item Master: everything this pump sells (Petrol, Diesel,
// Speed, Urea/AdBlue, lubricant SKUs, and anything else). Owner/Accountant/
// Manager only (see ItemsController) — this is master-data configuration,
// same access level as Nozzle/Tank setup.
//
// category/unit are real enums (not free text) because, unlike
// productType elsewhere in this schema, this IS the authoritative place a
// product is first registered — nothing upstream to be lenient about
// matching against yet.
export class CreateItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(ItemCategory)
  category!: ItemCategory;

  @IsEnum(ItemUnit)
  unit!: ItemUnit;
}
