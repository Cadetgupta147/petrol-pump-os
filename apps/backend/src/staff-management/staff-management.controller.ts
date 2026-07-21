import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { StaffManagementService } from './staff-management.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

// Section 3.7 — Staff Management (full CRUD, distinct from the minimal
// id+name picker at GET /staff). See staff-management.service.ts's class
// comment for the Owner-only-on-mutation judgment call.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('staff-management')
export class StaffManagementController {
  constructor(private readonly staffManagementService: StaffManagementService) {}

  @Get()
  findAll() {
    return this.staffManagementService.findAll();
  }

  @Roles(Role.OWNER)
  @Post()
  create(@Body() dto: CreateStaffDto) {
    return this.staffManagementService.create(dto);
  }

  @Roles(Role.OWNER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.staffManagementService.update(id, dto);
  }
}
