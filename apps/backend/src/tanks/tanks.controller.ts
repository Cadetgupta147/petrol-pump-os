import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { TanksService } from './tanks.service';
import { CreateTankDto } from './dto/create-tank.dto';
import { UpdateTankDto } from './dto/update-tank.dto';
import { CreateDipReadingDto } from './dto/create-dip-reading.dto';

// Section 7.1 (Tank core entity, minimal CRUD) + Section 7.2 step 3 (DIP
// reading + variance report).
//
// Auth: every route requires a valid JWT (global JwtAuthGuard, app.module.ts).
// Tank CRUD and the variance report are Owner/Accountant only — there's no
// concrete DSM need for tank configuration/reads, unlike the customer/gift
// lookups DSM needs at the counter. DIP reading creation additionally allows
// DSM — physical stick measurement is plausibly a DSM task, matching
// MeterReadingsController's openShift/closeShift DSM allowance. DIP reading
// reads (history) stay Owner/Accountant only.
//
// Route ordering note: 'variance-report' is registered before ':id' so it
// isn't swallowed by the :id param route.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('tanks')
export class TanksController {
  constructor(private readonly tanksService: TanksService) {}

  @Post()
  create(@Body() dto: CreateTankDto) {
    return this.tanksService.create(dto);
  }

  @Get()
  findAll() {
    return this.tanksService.findAll();
  }

  @Get('variance-report')
  varianceReport() {
    return this.tanksService.varianceReport();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tanksService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTankDto) {
    return this.tanksService.update(id, dto);
  }

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Post(':id/dip-readings')
  recordDipReading(
    @Param('id') id: string,
    @Body() dto: CreateDipReadingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tanksService.recordDipReading(id, dto, user.staffId);
  }

  @Get(':id/dip-readings')
  listDipReadings(@Param('id') id: string) {
    return this.tanksService.listDipReadings(id);
  }
}
