import { IsNumber, IsString, Min } from 'class-validator';

// Section 3.3 — DSM enters an opening meter reading for a nozzle at shift
// start. shiftStart itself is not client-supplied — it defaults to now()
// via the Prisma schema default.
//
// Section 7.2 — productType is required (non-optional) for every new shift
// going forward, so closeShift() can resolve which Tank to auto-deduct. It's
// nullable on the MeterReading model itself only so existing (legacy) rows
// don't need a migration backfill — see the schema comment on
// MeterReading.productType.
export class OpenShiftDto {
  @IsString()
  nozzleId!: string;

  @IsString()
  staffId!: string;

  @IsNumber()
  @Min(0)
  openingReading!: number;

  @IsString()
  productType!: string;
}
