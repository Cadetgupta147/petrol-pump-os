import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// POST /purchase-entries — Section 7.1's field list (date, supplier, product,
// quantity, rate, invoice_no, tanker_no, entered_via). `date` is not
// client-supplied — it's PurchaseEntry.createdAt, defaulted by the schema.
// `ocrExtracted` is pure provenance/audit metadata (did this entry originate
// from a Section 9 OCR-assisted flow) — it doesn't gate any authorization,
// amount, or trust decision, so it's safe to accept from the client.
// Defaults to false (manual entry) when omitted; the service persists
// whatever is sent rather than hardcoding it.
export class CreatePurchaseEntryDto {
  @IsString()
  supplierName!: string;

  @IsString()
  productType!: string;

  @IsNumber()
  @IsPositive()
  quantityLitres!: number;

  // Total invoice amount. Kept independent of ratePerLitre — see the schema
  // comment on PurchaseEntry.ratePerLitre for why the two aren't derived from
  // each other.
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsNumber()
  @IsPositive()
  ratePerLitre!: number;

  @IsOptional()
  @IsString()
  invoiceNo?: string;

  @IsOptional()
  @IsString()
  tankerNo?: string;

  @IsOptional()
  @IsString()
  invoiceImageUrl?: string;

  @IsOptional()
  @IsBoolean()
  ocrExtracted?: boolean;
}
