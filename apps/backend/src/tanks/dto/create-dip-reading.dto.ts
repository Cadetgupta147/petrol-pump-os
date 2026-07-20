import { IsNumber, IsString, Min } from 'class-validator';

// POST /tanks/:id/dip-readings — Section 7.2 step 3 (daily physical DIP
// reading). staffId is taken as a body field rather than pulled off the JWT,
// matching OpenShiftDto's existing convention for "who performed this
// physical action" fields in this codebase.
export class CreateDipReadingDto {
  @IsNumber()
  @Min(0)
  reading!: number;

  @IsString()
  staffId!: string;
}
