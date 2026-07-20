import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

// POST /tanks — Section 7.1 core entity. Owner/Accountant only (see
// TanksController). Minimal CRUD: nothing in the API creates a Tank row
// today, but PurchaseEntry and DipReading both need a real one to reference.
export class CreateTankDto {
  @IsString()
  productType!: string;

  @IsNumber()
  @Min(0)
  capacityLitres!: number;

  // Starting stock at the moment this tank is registered in the system —
  // not necessarily 0 (e.g. onboarding an already-operating pump).
  @IsNumber()
  @Min(0)
  currentStockLitres!: number;

  @IsOptional()
  @IsString()
  calibrationChartRef?: string;
}
