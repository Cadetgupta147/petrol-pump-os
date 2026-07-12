import { IsNumber, Min } from 'class-validator';

// Section 3.3 — DSM enters a closing meter reading at shift end; the app
// (here, the API) auto-calculates litres sold = closing - opening.
export class CloseShiftDto {
  @IsNumber()
  @Min(0)
  closingReading!: number;
}
