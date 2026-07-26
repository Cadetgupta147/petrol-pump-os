import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

// POST /lubricant-items — the SKU/pricing/stock extension for an Item
// already registered with category LUBRICANT (Item Master, Section 3.3.2).
// Owner/Accountant/Manager only (same access as Item Master itself).
export class CreateLubricantItemDto {
  @IsString()
  itemId!: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  costPrice?: number;

  @IsNumber()
  @IsPositive()
  salePrice!: number;

  @IsInt()
  @Min(0)
  stockQty!: number;

  @IsInt()
  @Min(0)
  reorderAt!: number;
}
