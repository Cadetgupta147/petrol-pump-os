import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

// POST /purchase-entries — Section 7.1's field list (date, supplier, product,
// quantity, rate, invoice_no, tanker_no, entered_via). `date` is not
// client-supplied — it's PurchaseEntry.createdAt, defaulted by the schema.
// `ocrExtracted` is pure provenance/audit metadata (did this entry originate
// from a Section 9 OCR-assisted flow) — it doesn't gate any authorization,
// amount, or trust decision, so it's safe to accept from the client.
// Defaults to false (manual entry) when omitted; the service persists
// whatever is sent rather than hardcoding it.
//
// Section 7.3 — densityValue/ppmValue are optional: a delivery doesn't
// always come with an on-the-spot quality check.
//
// Finding A1 (docs/production-readiness.md) — recordedById is NOT a DTO
// field (it used to be, gating on "if densityValue is present, recordedById
// must also be present" — that requirement no longer applies, since
// PurchasesController now always derives the actor from req.user.staffId
// and passes it to PurchasesService.create() as its own argument whenever
// densityValue is provided).
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

  @IsOptional()
  @IsNumber()
  @IsPositive()
  densityValue?: number;

  // Min(0), not IsPositive() — 0 ppm is a valid, ideal reading (see the same
  // note on CreateDensityLogDto.ppmValue).
  @IsOptional()
  @IsNumber()
  @Min(0)
  ppmValue?: number;
}
