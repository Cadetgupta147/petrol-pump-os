import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

// Section 3.4 — Customer master CRUD + full per-customer ledger.
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts). Open to any authenticated staff member — per Section 2,
// Owner and Accountant both have full access to customer management.
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

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
}
