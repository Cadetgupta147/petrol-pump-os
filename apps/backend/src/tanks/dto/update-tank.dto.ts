import { PartialType } from '@nestjs/mapped-types';
import { CreateTankDto } from './create-tank.dto';

// PATCH /tanks/:id — any subset of productType, capacityLitres,
// currentStockLitres, calibrationChartRef. Same PartialType pattern as
// UpdateGiftCatalogItemDto / UpdateCustomerDto.
//
// NOTE: currentStockLitres is editable here for manual correction (e.g.
// fixing a data-entry mistake at Tank creation), but day-to-day this field
// should only move via PurchaseEntry creation (increments) and
// MeterReading.closeShift (decrements) — see purchases.service.ts and
// meter-readings.service.ts. A direct PATCH bypasses those audit trails, so
// treat it as an administrative override, not a routine operation.
export class UpdateTankDto extends PartialType(CreateTankDto) {}
