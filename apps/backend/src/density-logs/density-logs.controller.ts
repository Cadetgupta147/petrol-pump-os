import { Controller, Body, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { DensityLogsService } from './density-logs.service';
import { CreateDensityLogDto } from './dto/create-density-log.dto';

// Section 7.3 — density/quality check. Creation additionally allows DSM
// (matches DIP reading creation's role set — see TanksController — physical
// stick/quality readings are plausibly a DSM task too); reads stay
// Owner/Accountant only (matches the read-side restriction already used for
// DIP reading history and tank reads).
@Roles(Role.OWNER, Role.ACCOUNTANT)
@Controller('density-logs')
export class DensityLogsController {
  constructor(private readonly densityLogsService: DensityLogsService) {}

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)
  @Post()
  create(@Body() dto: CreateDensityLogDto) {
    return this.densityLogsService.create(dto);
  }

  @Get()
  findAll(
    @Query('tankId') tankId?: string,
    @Query('purchaseEntryId') purchaseEntryId?: string,
    @Query('dipReadingId') dipReadingId?: string,
  ) {
    return this.densityLogsService.findAll({
      tankId,
      purchaseEntryId,
      dipReadingId,
    });
  }
}
