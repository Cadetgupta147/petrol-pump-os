import { Body, Controller, Get, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { MachineTestingService } from './machine-testing.service';
import { CreateMachineTestingLogDto } from './dto/create-machine-testing-log.dto';

// Dashboard "Machine testing/calibration" slice. Owner/Accountant/Manager —
// same set as ExpensesController/GeneratorDieselController.
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
@Controller('machine-testing-logs')
export class MachineTestingController {
  constructor(private readonly machineTestingService: MachineTestingService) {}

  @Post()
  create(
    @Body() dto: CreateMachineTestingLogDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.machineTestingService.create(dto, user.staffId);
  }

  @Get()
  findAll() {
    return this.machineTestingService.findAll();
  }
}
