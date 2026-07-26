import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

// POST /machine-testing-logs. performedById is NOT a DTO field —
// MachineTestingController derives it from req.user.staffId (Finding A1
// pattern, docs/production-readiness.md). litresDrawnOff defaults to 0 at
// the DB level when omitted — most calibration checks don't draw off any
// fuel (see MachineTestingService.create()).
export class CreateMachineTestingLogDto {
  @IsString()
  tankId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  litresDrawnOff?: number;

  @IsString()
  result!: string;

  @IsOptional()
  @IsNumber()
  deviationFound?: number;

  @IsOptional()
  @IsString()
  calibrationChartRef?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
