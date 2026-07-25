import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShiftScheduleService } from './shift-schedule.service';
import { CreateShiftDefinitionDto } from './dto/create-shift-definition.dto';
import { UpdateShiftDefinitionDto } from './dto/update-shift-definition.dto';

// Meter Reading redesign (Section 3.3) — the Owner-configurable shift
// schedule (Settings: "what are this pump's shift windows"), used purely to
// label which shift a batch-closing-readings submission belongs to (see
// meter-readings.controller.ts's POST /meter-readings/batch-close). Never a
// blocking gate — see resolve-current-shift-window.ts.
//
// Auth: every route requires a valid JWT (global JwtAuthGuard). Create/
// update are Owner/Accountant only — same access level as Nozzle Master
// (NozzlesController), not the wider Item Master access. findAll/findCurrent
// additionally allow DSM: the DSM app's batch-close screen reads these to
// show the current shift's label.
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('shift-schedule')
export class ShiftScheduleController {
  constructor(private readonly shiftScheduleService: ShiftScheduleService) {}

  @Post()
  create(@Body() dto: CreateShiftDefinitionDto) {
    return this.shiftScheduleService.create(dto);
  }

  // ?includeInactive=true — Settings screen only (see
  // ShiftScheduleService.findAll()'s comment); every other caller omits it
  // and gets active shift definitions only.
  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Get()
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.shiftScheduleService.findAll(includeInactive === 'true');
  }

  // Resolved current/most-recent shift window, for display only.
  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Get('current')
  findCurrent() {
    return this.shiftScheduleService.findCurrent();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateShiftDefinitionDto) {
    return this.shiftScheduleService.update(id, dto);
  }
}
