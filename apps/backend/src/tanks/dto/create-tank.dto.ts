import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// POST /tanks — Section 7.1 core entity. Owner/Accountant only (see
// TanksController). Minimal CRUD: nothing in the API creates a Tank row
// today, but PurchaseEntry and DipReading both need a real one to reference.
export class CreateTankDto {
  // Dealer-assigned physical tank number/label — must be unique per pump
  // (TanksService.create() surfaces a P2002 on this as a 400). Lets the
  // Nozzle Master tank picker disambiguate two tanks of the same product.
  @IsString()
  @IsNotEmpty()
  tankNumber!: string;

  @IsString()
  productType!: string;

  @IsNumber()
  @Min(0)
  capacityLitres!: number;

  // Starting stock at the moment this tank is registered in the system —
  // optional, defaults to 0 (e.g. a brand-new tank not yet filled). Set a
  // real figure when onboarding an already-operating pump.
  @IsOptional()
  @IsNumber()
  @Min(0)
  currentStockLitres?: number;

  @IsOptional()
  @IsString()
  calibrationChartRef?: string;
}
