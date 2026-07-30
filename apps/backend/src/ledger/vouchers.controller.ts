import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { VouchersService } from './vouchers.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { ListVouchersQueryDto } from './dto/list-vouchers-query.dto';
import { DayBookQueryDto } from './dto/day-book-query.dto';

// Section 12 — manual voucher entry + the Day Book report. Same role split
// as cash custody: Owner/Accountant/Manager can enter vouchers, Read-only
// can view but never write.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.READ_ONLY)
@Controller('vouchers')
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
  @Post()
  create(@Body() dto: CreateVoucherDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vouchersService.create(dto, user.staffId);
  }

  @Get()
  findAll(@Query() query: ListVouchersQueryDto) {
    return this.vouchersService.findAll(query);
  }

  // Placed before ':id' so 'day-book' isn't swallowed as a route param.
  @Get('day-book')
  getDayBook(@Query() query: DayBookQueryDto) {
    return this.vouchersService.getDayBook(query.date);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vouchersService.findOne(id);
  }

  @Roles(Role.OWNER)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.vouchersService.remove(id);
  }
}
