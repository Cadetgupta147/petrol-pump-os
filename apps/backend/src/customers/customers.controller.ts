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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { SetLoyaltyRateOverrideDto } from './dto/set-loyalty-rate-override.dto';
import { RecordConsentDto } from './dto/record-consent.dto';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';

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

  // Section 6.3 step 2/3 — resolve a scanned/hand-typed member ID for the
  // DSM app's New Bill auto-fill. DSM-allowed like findAll() (this IS the
  // DSM's QR-scan workflow); returns a minimal projection, not the full
  // customer record — see CustomersService.findByMemberId(). Declared
  // before the ':id' routes so the literal segment can never be captured as
  // a customer id.
  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Get('by-member-id/:qrMemberId')
  findByMemberId(@Param('qrMemberId') qrMemberId: string) {
    return this.customersService.findByMemberId(qrMemberId);
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

  // Section 3.4 — onboarding an existing (pre-system) credit customer with a
  // real outstanding balance from before this pump used the software.
  // Owner/Accountant via the class-level @Roles, same as the rest of
  // customer/credit management. Human-review flag (CLAUDE.md): this touches
  // money/credit balances directly.
  @Post(':id/opening-balance')
  addOpeningBalance(
    @Param('id') id: string,
    @Body() dto: CreateOpeningBalanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customersService.addOpeningBalance(id, dto, user);
  }

  @Get(':id/opening-balance')
  listOpeningBalances(@Param('id') id: string) {
    return this.customersService.listOpeningBalances(id);
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

  // Section 17.11 — DPDP Act compliance scaffolding (go-live blocker,
  // Section 18.1). Owner/Accountant via the class-level @Roles — same
  // access level as the rest of customer management, since consent capture
  // is itself a normal part of onboarding a customer.
  @Patch(':id/consent')
  recordConsent(@Param('id') id: string, @Body() dto: RecordConsentDto) {
    return this.customersService.recordConsent(id, dto);
  }

  // Right to access — exports every piece of personal data this pump holds
  // about the customer. Owner/Accountant only via the class-level @Roles.
  @Get(':id/data-export')
  exportData(@Param('id') id: string) {
    return this.customersService.exportData(id);
  }

  // Right to erasure — Owner-ONLY (irreversible; anonymizes, doesn't
  // hard-delete — see CustomersService.requestDeletion()'s comment for the
  // per-pump-membership scope limitation).
  @Roles(Role.OWNER)
  @Post(':id/data-deletion')
  requestDeletion(@Param('id') id: string) {
    return this.customersService.requestDeletion(id);
  }
}
