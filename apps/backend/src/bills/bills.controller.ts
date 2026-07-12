import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { BillsService } from './bills.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { DeleteBillDto } from './dto/delete-bill.dto';

// Section 3.2 — manual bill entry / bill register (create, read, edit,
// soft-delete).
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts) and is open to any authenticated staff member — per
// Section 2, Owner and Accountant both have full access to bill entry/edit.
// No @Roles() restriction here; this module is money-touching (Section 5A
// split payments, Section 3.4 credit limit), so keep server-side balancing
// checks (BillsService) as the actual safeguard, not just who's logged in.
@Controller('bills')
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

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

  @Delete(':id')
  remove(@Param('id') id: string, @Body() dto: DeleteBillDto) {
    return this.billsService.remove(id, dto);
  }
}
