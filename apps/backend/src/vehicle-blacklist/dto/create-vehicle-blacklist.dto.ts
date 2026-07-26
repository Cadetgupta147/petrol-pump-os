import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { BlacklistScope } from '@prisma/client';

// POST /vehicle-blacklist. vehicleNumber is required for scope=VEHICLE,
// companyName for scope=COMPANY — cross-field, so enforced here via
// ValidateIf rather than both fields just being independently optional
// (which would silently accept a COMPANY entry with no companyName at all).
// VehicleBlacklistService re-checks the same rule server-side too, since
// ValidateIf only protects the HTTP entry point, not every caller.
export class CreateVehicleBlacklistDto {
  @IsEnum(BlacklistScope)
  scope!: BlacklistScope;

  @ValidateIf((o: CreateVehicleBlacklistDto) => o.scope === 'VEHICLE')
  @IsString()
  @IsNotEmpty()
  vehicleNumber?: string;

  @ValidateIf((o: CreateVehicleBlacklistDto) => o.scope === 'COMPANY')
  @IsString()
  @IsNotEmpty()
  companyName?: string;

  // Optional link to an existing Customer, if one exists for this
  // vehicle/company — never required, since the whole point is to be able
  // to blacklist a vehicle number that walked off before ever becoming a
  // proper Customer record.
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  outstandingAmount?: number;

  // Reference photo for staff to manually compare against the person at the
  // pump — never used for automated face-matching. See the VehicleBlacklist
  // model's comment in schema.prisma for why that's a deliberate boundary,
  // not a missing feature.
  @IsOptional()
  @IsString()
  referencePhotoUrl?: string;
}
