import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { BillsService } from './bills.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { DeleteBillDto } from './dto/delete-bill.dto';

// Section 3.2 — manual bill entry / bill register (create, read, edit,
// soft-delete).
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts) and is explicitly restricted to Owner/Accountant via
// @Roles(Role.OWNER, Role.ACCOUNTANT) below — per Section 2, both have full
// access to bill entry/edit. This module is money-touching (Section 5A split
// payments, Section 3.4 credit limit), so keep server-side balancing checks
// (BillsService) as the actual safeguard too, not just who's logged in.
// create() additionally allows Role.DSM — per Section 2/4, DSM/Cashier must
// be able to create bills from the DSM app's core workflow.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('bills')
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Post()
  create(@Body() dto: CreateBillDto) {
    return this.billsService.create(dto);
  }

  @Get()
  findAll() {
    return this.billsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.billsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBillDto) {
    return this.billsService.update(id, dto);
  }

  // remove() is Owner-only — deletion of billing history is treated as more
  // consequential than edit access, deliberately narrower than Section 3.2's
  // edit/delete parity language.
  @Roles(Role.OWNER)
  @Delete(':id')
  remove(@Param('id') id: string, @Body() dto: DeleteBillDto) {
    return this.billsService.remove(id, dto);
  }
}
