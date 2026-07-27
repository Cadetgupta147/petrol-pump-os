import { IsNumber, IsString, Min } from 'class-validator';

// PUT /tax-rate-config — Section 17.22. One row per productType; 0 is a
// valid rate (a dealer explicitly marking a product untaxed, distinct from
// "no row configured" — see TaxRateConfigService/sales-purchase-register).
export class UpsertTaxRateConfigDto {
  @IsString()
  productType!: string;

  @IsNumber()
  @Min(0)
  taxRatePercent!: number;
}
