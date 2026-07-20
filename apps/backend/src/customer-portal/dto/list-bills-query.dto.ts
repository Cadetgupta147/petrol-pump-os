import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// GET /customer-portal/bills?limit= — Section 5's bill history. This is a
// customer's own phone screen, not an export: default to a small page and
// cap it firmly rather than trusting whatever limit the client sends.
// @Type(() => Number) is required for query-string coercion — the global
// ValidationPipe (main.ts) has `transform: true` but not
// `enableImplicitConversion`, so without this decorator the raw string
// query value would fail @IsInt().
export class ListBillsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
