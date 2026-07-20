import { IsDateString, IsNumber, IsPositive, IsString } from 'class-validator';

// POST /rate-master — Section 7.4. Append-only: there is no update/delete
// DTO on purpose — corrections are new dated rows (see RateMasterService).
export class CreateRateHistoryDto {
  @IsString()
  productType!: string;

  @IsNumber()
  @IsPositive()
  rate!: number;

  @IsDateString()
  effectiveFrom!: string;
}
