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

// Section 3.4 — Customer master CRUD (create/view/edit only; no ledger here).
//
// NO AUTH/ROLE GUARDS YET — this repo has no auth infrastructure at all
// (see CLAUDE.md: "never trust the frontend to enforce permissions" /
// Section 2 role matrix). Every endpoint below is currently open to anyone
// who can reach the API. Flagged in the module report — must be closed
// before this ships past local development.
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
}
