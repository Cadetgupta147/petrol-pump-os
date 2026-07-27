import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RateMasterService } from './rate-master.service';
import { CreateRateHistoryDto } from './dto/create-rate-history.dto';

// Section 7.4 — Rate Master. Owner/Accountant only (same config-data scoping
// as TanksController) — no concrete DSM need to browse/edit rate history
// directly; DSM-created bills get the resolved rate through BillsService's
// in-process dependency on RateMasterService, not via this controller.
//
// Route ordering note (same convention as TanksController's variance-report):
// 'current' is registered before any future ':id' route so it isn't
// swallowed by a param route.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('rate-master')
export class RateMasterController {
  constructor(private readonly rateMasterService: RateMasterService) {}

  @Post()
  create(@Body() dto: CreateRateHistoryDto) {
    return this.rateMasterService.create(dto);
  }

  // Method-level override: a DSM needs the CURRENT price for whatever
  // product they've selected on the New Bill screen, to auto-calculate
  // litres from amount (or vice versa) before Save — see NewBillScreen.tsx.
  // This is narrower than full history access (findAll() below stays
  // Owner/Accountant-only): a DSM gets today's price for one product at a
  // time, not the pump's pricing-change history. Not a real exposure either
  // way — the price is the same one posted on the pump's signboard.
  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Get('current')
  getCurrentRate(@Query('productType') productType: string) {
    return this.rateMasterService.getCurrentRate(productType);
  }

  @Get()
  findAll(@Query('productType') productType?: string) {
    return this.rateMasterService.findAll(productType);
  }
}
