import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { resolveAssignableActorId } from '../common/resolve-assignable-actor';
import { ClockInDto } from './dto/clock-in.dto';
import { DateRangeQueryDto } from '../common/dto/date-range-query.dto';
import { parseDateRangeStrings } from '../common/date-range.util';
import { StaffAdvancesService } from '../staff-advances/staff-advances.service';

// Section 12 — "Staff attendance & salary summary: hours worked, advances,
// salary due." `AttendanceLog` already existed in schema.prisma
// (staffId/clockIn/clockOut) but had NO controller/service anywhere in this
// codebase before this slice.
//
// SCOPE — built vs. explicitly NOT built, flagged per CLAUDE.md's "don't
// hardcode a guess — surface it if it blocks you" rule rather than silently
// skipped:
//   - Clock-in / clock-out + hours-worked summary: BUILT, fully, below.
//   - "Advances" and "salary due" (Section 17.23, resolved as FIXED MONTHLY
//     SALARY — see Staff.monthlySalary and the StaffAdvance model): BUILT,
//     with one remaining, explicitly flagged gap — a genuine "net salary
//     due for THIS date range" figure needs a payroll-period/cutoff-date
//     decision (prorating a flat monthly figure across an arbitrary from/to
//     range is its own undocumented assumption) that hasn't been made
//     either. So getSummary() below reports monthlySalary (the configured
//     rate, informational) and outstandingAdvances (the running unpaid
//     balance as of NOW, not scoped to the query range — see
//     StaffAdvancesService.getOutstandingTotalsByStaff()) side by side,
//     rather than a single computed "amount payable" this range doesn't
//     have a well-defined meaning for yet.
//
// Auth: enforced at the controller level (global JwtAuthGuard + RolesGuard,
// see attendance.controller.ts).
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAdvancesService: StaffAdvancesService,
  ) {}

  // Finding A1 — staffId is resolved via resolveAssignableActorId() (see
  // that function's header comment): omitted -> the caller; explicitly set
  // to someone else -> allowed for non-DSM callers only.
  async clockIn(dto: ClockInDto, user: AuthenticatedUser) {
    const staffId = resolveAssignableActorId(user, dto.staffId);

    // Same "no two open sessions" guard as
    // MeterReadingsService.openShift()'s "no two open shifts per nozzle" —
    // scoped per staff member here instead of per nozzle.
    const existingOpen = await this.prisma.attendanceLog.findFirst({
      where: { staffId, clockOut: null },
    });
    if (existingOpen) {
      throw new ConflictException(
        `Staff ${staffId} is already clocked in (attendanceLogId: ${existingOpen.id}) — clock out before clocking in again`,
      );
    }

    try {
      return await this.prisma.attendanceLog.create({
        data: { staffId, clockIn: new Date() },
      });
    } catch (error) {
      this.handlePrismaError(error, staffId);
    }
  }

  async clockOut(id: string) {
    const existing = await this.prisma.attendanceLog.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`AttendanceLog ${id} not found`);
    }
    if (existing.clockOut !== null) {
      throw new ConflictException(`AttendanceLog ${id} is already clocked out`);
    }

    return this.prisma.attendanceLog.update({
      where: { id },
      data: { clockOut: new Date() },
    });
  }

  findAll() {
    return this.prisma.attendanceLog.findMany({
      orderBy: { clockIn: 'desc' },
      include: { staff: { select: { id: true, name: true } } },
    });
  }

  // Self-service status check for the DSM app: findAll()/GET /attendance is
  // Owner/Accountant/Manager only (see attendance.controller.ts), so a DSM
  // caller has no other way to learn whether they're currently clocked in,
  // or to get the AttendanceLog id clockOut() needs. Always scoped to the
  // caller themselves — never accepts a staffId param — since this is a
  // "check my own status" read, not an assignable-on-behalf-of action like
  // clockIn()/resolveAssignableActorId().
  async getMyStatus(user: AuthenticatedUser) {
    const openLog = await this.prisma.attendanceLog.findFirst({
      where: { staffId: user.staffId, clockOut: null },
    });
    return { openLog };
  }

  // Section 12 — the hours-worked half of "Staff attendance & salary
  // summary". A session is attributed to the day it STARTED (clockIn falls
  // in [start, end]) — same "attribute to the start" convention as other
  // shift-based approximations in this codebase (see
  // MeterReadingsService.checkVariance()'s comment). A session still open
  // (clockOut === null) counts hours up to NOW rather than up to the query
  // range's end, and marks that staff member `stillClockedIn: true` so the
  // report doesn't silently understate someone who's mid-shift right now.
  async getSummary(dto: DateRangeQueryDto) {
    const { start, end } = parseDateRangeStrings(dto.from, dto.to);
    const now = new Date();

    const logs = await this.prisma.attendanceLog.findMany({
      where: { clockIn: { gte: start, lte: end } },
      include: { staff: { select: { id: true, name: true } } },
      orderBy: { clockIn: 'asc' },
    });

    const byStaff = new Map<
      string,
      {
        staffId: string;
        staffName: string;
        totalHoursWorked: number;
        sessionCount: number;
        stillClockedIn: boolean;
        monthlySalary: number | null;
        outstandingAdvances: number;
      }
    >();

    for (const log of logs) {
      const effectiveClockOut = log.clockOut ?? now;
      const hours = Math.max(
        0,
        (effectiveClockOut.getTime() - log.clockIn.getTime()) /
          (1000 * 60 * 60),
      );

      const entry = byStaff.get(log.staffId) ?? {
        staffId: log.staffId,
        staffName: log.staff.name,
        totalHoursWorked: 0,
        sessionCount: 0,
        stillClockedIn: false,
        monthlySalary: null,
        outstandingAdvances: 0,
      };
      entry.totalHoursWorked += hours;
      entry.sessionCount += 1;
      if (log.clockOut === null) {
        entry.stillClockedIn = true;
      }
      byStaff.set(log.staffId, entry);
    }

    // Section 17.23 — fold in monthlySalary (the configured rate) and
    // outstandingAdvances (current unpaid running balance, not scoped to
    // [start, end] — see this class's header comment for why) for every
    // staff member who has at least one attendance session in range.
    const staffIds = Array.from(byStaff.keys());
    const [staffRows, outstandingByStaff] = await Promise.all([
      this.prisma.staff.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, monthlySalary: true },
      }),
      this.staffAdvancesService.getOutstandingTotalsByStaff(),
    ]);
    const monthlySalaryByStaff = new Map(staffRows.map((row) => [row.id, row.monthlySalary]));
    for (const entry of byStaff.values()) {
      entry.monthlySalary = monthlySalaryByStaff.get(entry.staffId) ?? null;
      entry.outstandingAdvances = outstandingByStaff[entry.staffId] ?? 0;
    }

    return {
      from: start,
      to: end,
      staff: Array.from(byStaff.values()).sort(
        (a, b) => b.totalHoursWorked - a.totalHoursWorked,
      ),
      // See the class-level comment above: monthlySalary/outstandingAdvances
      // are now real, per-staff numbers — this note now only flags the one
      // remaining gap (no payroll-period proration), not "nothing computed
      // at all".
      salaryAndAdvancesNote:
        'monthlySalary and outstandingAdvances are now computed per staff member (Section 17.23, fixed monthly salary). monthlySalary is null for any staff member with no configured rate — not defaulted to 0. There is still no "net salary due for this date range" figure: prorating a flat monthly salary across an arbitrary from/to range needs a payroll-period/cutoff-date decision this codebase has not made — see AttendanceService for the full writeup.',
    };
  }

  private handlePrismaError(error: unknown, staffId: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        throw new BadRequestException(
          `${staffId} does not reference an existing Staff record`,
        );
      }
    }
    throw error;
  }
}
