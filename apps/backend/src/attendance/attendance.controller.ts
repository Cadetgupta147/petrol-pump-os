import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { AttendanceService } from './attendance.service';
import { ClockInDto } from './dto/clock-in.dto';
import { DateRangeQueryDto } from '../common/dto/date-range-query.dto';

// Section 12 — staff attendance (hours-worked half only; see
// attendance.service.ts's class comment for the advances/salary-due scope
// gap, deliberately not built here).
//
// Auth: every route below requires a valid JWT (global JwtAuthGuard, see
// app.module.ts). Clock-in/out is allowed broadly across
// Owner/Accountant/Manager/DSM — Section 2 lists "staff attendance" as a
// Manager capability, and Section 4 ties DSM login to attendance, so
// capture needs to work from whichever channel/role a staff member is
// actually using, not just Owner/Accountant (same reasoning as
// CashCustodyController's create route).
@Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.DSM)
  @Post('clock-in')
  clockIn(@Body() dto: ClockInDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.clockIn(dto, user);
  }

  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.DSM)
  @Patch(':id/clock-out')
  clockOut(@Param('id') id: string) {
    return this.attendanceService.clockOut(id);
  }

  // 'me' is a distinct static path segment under the collection root, ahead
  // of any future ':id' GET route — same reasoning as 'summary' below. Lets
  // the DSM app show "clocked in since HH:MM" / "not clocked in" and get the
  // log id clock-out needs, without opening up GET /attendance (which stays
  // Owner/Accountant/Manager only) to DSM callers.
  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.MANAGER, Role.DSM)
  @Get('me')
  getMyStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.getMyStatus(user);
  }

  @Get()
  findAll() {
    return this.attendanceService.findAll();
  }

  // Section 12 report — the hours-worked summary. 'summary' is a distinct
  // static path segment under the collection root (no ':id' route exists
  // on this controller to collide with).
  @Roles(Role.OWNER, Role.ACCOUNTANT, Role.READ_ONLY)
  @Get('summary')
  getSummary(@Query() dto: DateRangeQueryDto) {
    return this.attendanceService.getSummary(dto);
  }
}
