import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShiftSalesService } from './shift-sales.service';
import { CreateShiftSalesSummaryDto } from './dto/create-shift-sales-summary.dto';
import { UpdateShiftSalesSummaryDto } from './dto/update-shift-sales-summary.dto';

// Section 8A.2 — ShiftSalesSummary (walk-in aggregate sales + variance
// check). Same role pattern as MeterReadingsController (the closest analog):
// Owner/Accountant/Manager have full access by default; DSM can additionally
// submit/correct their own shift's cash/card totals, same as they submit
// meter readings.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
@Controller('shift-sales')
export class ShiftSalesController {
  constructor(private readonly shiftSalesService: ShiftSalesService) {}

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.DSM)
  @Post()
  create(@Body() dto: CreateShiftSalesSummaryDto) {
    return this.shiftSalesService.create(dto);
  }

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.DSM)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateShiftSalesSummaryDto) {
    return this.shiftSalesService.update(id, dto);
  }

  @Get()
  findAll() {
    return this.shiftSalesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shiftSalesService.findOne(id);
  }
}
