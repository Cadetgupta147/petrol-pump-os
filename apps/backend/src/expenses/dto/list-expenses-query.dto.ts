import { IsDateString, IsOptional } from 'class-validator';

// GET /expenses?from=&to= — both independently optional, same convention as
// ListBillsQueryDto (apps/backend/src/bills/dto/list-bills-query.dto.ts).
export class ListExpensesQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
