import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// POST /staff-advances — Section 17.23. staffId is OPTIONAL and follows the
// same assignable-actor pattern as ClockInDto.staffId/CreateCashCustodyLogDto
// .handledById: omitted -> the caller; explicitly set to someone else ->
// allowed for non-DSM callers only (a Manager recording an advance given to
// a DSM). recordedById is NOT a DTO field — the controller derives it
// unconditionally from the authenticated caller (this transaction's actor,
// not who it's about — see resolve-assignable-actor.ts's header comment for
// the distinction).
export class CreateStaffAdvanceDto {
  @IsOptional()
  @IsString()
  staffId?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
