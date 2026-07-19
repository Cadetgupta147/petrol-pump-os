import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

// POST /loyalty/calculate-points — Section 6.2/6.3. Two mutually exclusive
// input shapes (mixing them is rejected in LoyaltyService.calculatePoints):
//
//   { billId }                            — calculate for an existing bill
//   { amount, litres, customerId? }       — calculate for a prospective bill
//                                           (the DSM app's live preview at
//                                           entry time, before the bill row
//                                           exists)
//
// amount/litres allow 0 (a zero bill earns zero points — not an error), but
// are required whenever billId is absent.
export class CalculatePointsDto {
  @IsOptional()
  @IsString()
  billId?: string;

  @ValidateIf((dto: CalculatePointsDto) => dto.billId === undefined)
  @IsNumber()
  @Min(0)
  amount?: number;

  @ValidateIf((dto: CalculatePointsDto) => dto.billId === undefined)
  @IsNumber()
  @Min(0)
  litres?: number;

  @IsOptional()
  @IsString()
  customerId?: string;
}
