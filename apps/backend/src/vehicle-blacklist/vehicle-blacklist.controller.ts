import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BlacklistStatus, Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { VehicleBlacklistService } from './vehicle-blacklist.service';
import { CreateVehicleBlacklistDto } from './dto/create-vehicle-blacklist.dto';
import { ResolveVehicleBlacklistDto } from './dto/resolve-vehicle-blacklist.dto';

// Section 3.4B — vehicle/company credit blacklist.
//
// Auth: global JwtAuthGuard applies. create()/resolve() are Owner-only —
// same precedent as CreditConfigController (Section 3.4A's enforcementMode
// is Owner-only too), since an active blacklist entry is a *stronger*,
// fully automatic block than enforcementMode ever applies, so it can't be a
// looser permission than that. Viewing the list and running the pre-check
// are open to everyone who already sees credit data, including DSM — same
// reasoning as BillsController giving DSM access to create() — because the
// DSM standing at the pump is exactly who needs to know before fueling a
// vehicle on credit.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.DSM, Role.READ_ONLY)
@Controller('vehicle-blacklist')
export class VehicleBlacklistController {
  constructor(
    private readonly vehicleBlacklistService: VehicleBlacklistService,
  ) {}

  @Roles(Role.OWNER)
  @Post()
  create(
    @Body() dto: CreateVehicleBlacklistDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vehicleBlacklistService.create(dto, user.staffId);
  }

  @Get()
  findAll(@Query('status') status?: BlacklistStatus) {
    return this.vehicleBlacklistService.findAll(status);
  }

  // Pre-check for the DSM app / web portal: "is it OK to fuel this vehicle
  // on credit" BEFORE committing to the sale. Declared before ':id' so the
  // literal 'check' segment can never be captured as an id param (same
  // precedent as CustomersController's 'by-member-id/:qrMemberId').
  // vehicleNumber accepts a comma-separated list so the caller can check
  // both a typed-in number and a customer's on-file one in one request, same
  // as BillsService.create()'s own multi-candidate check.
  @Get('check')
  check(
    @Query('vehicleNumber') vehicleNumber?: string,
    @Query('companyName') companyName?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.vehicleBlacklistService.checkBlock({
      vehicleNumbers: vehicleNumber ? vehicleNumber.split(',') : [],
      companyName,
      customerId,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vehicleBlacklistService.findOne(id);
  }

  @Roles(Role.OWNER)
  @Patch(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveVehicleBlacklistDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vehicleBlacklistService.resolve(id, dto, user.staffId);
  }
}
