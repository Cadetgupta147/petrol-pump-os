import { IsNumber, IsString, Min } from 'class-validator';

// Section 3.3 — DSM enters an opening meter reading for a nozzle at shift
// start. shiftStart itself is not client-supplied — it defaults to now()
// via the Prisma schema default.
export class OpenShiftDto {
  @IsString()
  nozzleId!: string;

  @IsString()
  staffId!: string;

  @IsNumber()
  @Min(0)
  openingReading!: number;
}
