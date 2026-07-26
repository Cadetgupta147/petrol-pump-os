import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// POST /generator-diesel-logs. recordedById is NOT a DTO field —
// GeneratorDieselController derives it from req.user.staffId (Finding A1
// pattern, docs/production-readiness.md).
export class CreateGeneratorDieselLogDto {
  @IsString()
  tankId!: string;

  @IsNumber()
  @IsPositive()
  quantityLitres!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
