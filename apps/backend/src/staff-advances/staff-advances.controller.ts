import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { StaffAdvancesService } from './staff-advances.service';
import { CreateStaffAdvanceDto } from './dto/create-staff-advance.dto';

// Section 17.23 — staff wage/advances. Owner/Accountant/Manager, matching
// CashCustodyController's role set (routine cash-handling bookkeeping, not
// a business-policy change — contrast with Staff.monthlySalary, which is
// Owner-only via staff-management since it's closer to a compensation
// policy decision).
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
@Controller('staff-advances')
export class StaffAdvancesController {
  constructor(private readonly staffAdvancesService: StaffAdvancesService) {}

  @Post()
  create(@Body() dto: CreateStaffAdvanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.staffAdvancesService.create(dto, user);
  }

  @Get()
  findAll(@Query('staffId') staffId?: string) {
    return this.staffAdvancesService.findAll({ staffId });
  }

  @Patch(':id/repay')
  markRepaid(@Param('id') id: string) {
    return this.staffAdvancesService.markRepaid(id);
  }
}
