import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, Min, MinLength } from 'class-validator';

// One extra (non-fuel) item row on a bill — e.g. a can of engine oil handed
// over with the same fill-up (prisma/schema.prisma's BillLineItem comment
// has the full reasoning: fuel itself stays on Bill.litres/productType/
// rateApplied exactly as before, untouched, no tax field there).
//
// taxRate/rate/quantity here are what the client submits; BillsService.
// create() resolves the rest (amount, cgstAmount/sgstAmount/igstAmount,
// lineTotal) itself server-side — CLAUDE.md's "never trust the frontend"
// rule applies directly to these money fields. When itemId is given but
// itemCode/itemName/taxRate are omitted, the server fills them in from the
// referenced Item (code/taxRate default, name always); when itemId is
// omitted entirely, itemName is required as free text (a one-off item not
// worth registering in Item Master) and taxRate defaults to 0 if not given.
export class CreateBillLineItemDto {
  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsString()
  itemCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  itemName?: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsNumber()
  @IsPositive()
  rate!: number;

  // Intra-state (default) splits the combined taxRate into CGST+SGST;
  // inter-state charges the whole rate as IGST instead.
  @IsOptional()
  @IsBoolean()
  isInterstate?: boolean;

  // Combined GST % for this line. Optional: when omitted and itemId is
  // given, the server falls back to that Item's default taxRate (then 0 if
  // even that isn't set) — see BillsService.resolveLineItem().
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;
}
