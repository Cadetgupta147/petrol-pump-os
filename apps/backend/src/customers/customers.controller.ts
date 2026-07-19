import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { SetLoyaltyRateOverrideDto } from './dto/set-loyalty-rate-override.dto';

// Section 3.4 — Customer master CRUD + full per-customer ledger.
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts) and is explicitly restricted to Owner/Accountant via
// @Roles(Role.OWNER, Role.ACCOUNTANT) below — per Section 2, both have full
// access to customer management.
// findAll() additionally allows Role.DSM — per Section 4, DSM needs customer
// lookup for the credit picker.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Get()
  findAll() {
    return this.customersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  // Section 3.4 — full ledger per customer: every bill, every payment,
  // running balance.
  @Get(':id/ledger')
  ledger(@Param('id') id: string) {
    return this.customersService.ledger(id);
  }

  // Section 6.1 — the customer's QR card. The QR encodes ONLY qrMemberId
  // (see CustomersService.qrCard). Owner/Accountant via the class-level
  // @Roles — card generation/printing is a back-office task, not a DSM one
  // (the DSM app scans cards, it doesn't mint them).
  @Get(':id/qr')
  qrCard(@Param('id') id: string) {
    return this.customersService.qrCard(id);
  }

  // Section 6.2 — per-customer earning rate override. Owner-ONLY: Section 2
  // lists "cannot change loyalty rates" as an Accountant restriction, and
  // the per-customer override is a loyalty rate.
  @Roles(Role.OWNER)
  @Patch(':id/loyalty-rate-override')
  setLoyaltyRateOverride(
    @Param('id') id: string,
    @Body() dto: SetLoyaltyRateOverrideDto,
  ) {
    return this.customersService.setLoyaltyRateOverride(id, dto);
  }
}
