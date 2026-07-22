import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { NozzlesService } from './nozzles.service';
import { CreateNozzleDto } from './dto/create-nozzle.dto';
import { UpdateNozzleDto } from './dto/update-nozzle.dto';

// Section 3.3/4 — Nozzle master (Settings: "how many nozzles does this pump
// have").
//
// Auth: every route requires a valid JWT (global JwtAuthGuard). Create/
// update are Owner/Accountant only — configuring the physical nozzle layout
// is a Settings-level action, same access level as Tank CRUD
// (TanksController). findAll/findOne additionally allow DSM: the DSM app's
// shift-start/close screens need this list to populate their nozzle
// dropdown (read-only access, no write path for that role).
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('nozzles')
export class NozzlesController {
  constructor(private readonly nozzlesService: NozzlesService) {}

  @Post()
  create(@Body() dto: CreateNozzleDto) {
    return this.nozzlesService.create(dto);
  }

  // ?includeInactive=true — Settings screen only (see
  // NozzlesService.findAll()'s comment); every other caller (DSM app/web
  // portal shift-open pickers) omits it and gets active nozzles only.
  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Get()
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.nozzlesService.findAll(includeInactive === 'true');
  }

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.nozzlesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNozzleDto) {
    return this.nozzlesService.update(id, dto);
  }
}
