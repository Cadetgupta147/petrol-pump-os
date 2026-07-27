import { IsNumber, IsPositive, IsString } from 'class-validator';

// PUT /density-range-config — Section 17.19. One row per productType; minDensity
// < maxDensity is enforced in the service (a cross-field check, not
// expressible with class-validator decorators alone).
export class UpsertDensityRangeConfigDto {
  @IsString()
  productType!: string;

  @IsNumber()
  @IsPositive()
  minDensity!: number;

  @IsNumber()
  @IsPositive()
  maxDensity!: number;
}
