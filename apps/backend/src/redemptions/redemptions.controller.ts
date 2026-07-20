import { Body, Controller, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RedemptionsService } from './redemptions.service';
import { CreateRedemptionDto } from './dto/create-redemption.dto';

// Section 6.4 (redemption policy) + Section 6.6 (DSM-at-counter redemption
// flow — "DSM scans QR -> app shows available points and redemption options
// -> customer chooses -> discount or gift is applied/recorded -> points
// deducted").
//
// Auth: valid JWT required globally (app.module.ts). DSM is allowed here in
// addition to Owner/Accountant, same access level as BillsController.create
// — the DSM processes redemptions at the counter. All the actual policy
// enforcement (which redemption type is allowed, balance/stock checks) is
// server-side in RedemptionsService — the DSM app is never trusted to
// enforce this itself (CLAUDE.md).
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
@Controller('redemptions')
export class RedemptionsController {
  constructor(private readonly redemptionsService: RedemptionsService) {}

  @Post()
  create(@Body() dto: CreateRedemptionDto) {
    return this.redemptionsService.create(dto);
  }
}
