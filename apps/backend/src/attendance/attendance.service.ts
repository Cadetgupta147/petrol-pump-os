import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClockInDto } from './dto/clock-in.dto';
import { DateRangeQueryDto } from '../common/dto/date-range-query.dto';
import { parseDateRangeStrings } from '../common/date-range.util';

// Section 12 — "Staff attendance & salary summary: hours worked, advances,
// salary due." `AttendanceLog` already existed in schema.prisma
// (staffId/clockIn/clockOut) but had NO controller/service anywhere in this
// codebase before this slice.
//
// SCOPE — built vs. explicitly NOT built, flagged per CLAUDE.md's "don't
// hardcode a guess — surface it if it blocks you" rule rather than silently
// skipped:
//   - Clock-in / clock-out + hours-worked summary: BUILT, fully, below.
//   - "Advances" and "salary due": NOT built, and deliberately so. There is
//     no wage/salary-rate field anywhere on `Staff`, and no advances table
//     in schema.prisma. Building this for real needs an actual decision
//     this codebase doesn't have yet — daily wage vs. monthly salary vs.
//     per-litre commission, and how an advance gets recorded/repaid (a
//     ledger mirroring Customer's credit ledger? a running balance on
//     Staff?). Inventing any of that here would be exactly the kind of
//     undocumented salary-structure guess CLAUDE.md tells this agent to
//     surface instead of silently picking. getSummary() below returns an
//     explicit `salaryAndAdvancesNote` field explaining this, rather than a
//     hardcoded 0 or an omitted field a caller could mistake for "nothing
//     owed".
//
// Auth: enforced at the controller level (global JwtAuthGuard + RolesGuard,
// see attendance.controller.ts).
@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async clockIn(dto: ClockInDto) {
    // Same "no two open sessions" guard as
    // MeterReadingsService.openShift()'s "no two open shifts per nozzle" —
    // scoped per staff member here instead of per nozzle.
    const existingOpen = await this.prisma.attendanceLog.findFirst({
      where: { staffId: dto.staffId, clockOut: null },
    });
    if (existingOpen) {
      throw new ConflictException(
        `Staff ${dto.staffId} is already clocked in (attendanceLogId: ${existingOpen.id}) — clock out before clocking in again`,
      );
    }

    try {
      return await this.prisma.attendanceLog.create({
        data: { staffId: dto.staffId, clockIn: new Date() },
      });
    } catch (error) {
      this.handlePrismaError(error, dto.staffId);
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
      };
      entry.totalHoursWorked += hours;
      entry.sessionCount += 1;
      if (log.clockOut === null) {
        entry.stillClockedIn = true;
      }
      byStaff.set(log.staffId, entry);
    }

    return {
      from: start,
      to: end,
      staff: Array.from(byStaff.values()).sort(
        (a, b) => b.totalHoursWorked - a.totalHoursWorked,
      ),
      // See the class-level comment above: advances/salary-due are a
      // genuine BLOCKED gap, not a silent zero.
      salaryAndAdvancesNote:
        'Not computed: this schema has no wage/salary-rate field on Staff and no advances table, so "salary due" cannot be derived yet. Needs a real decision (daily wage / monthly salary / per-litre commission, and how advances are recorded/repaid) before this can be built — see the handback notes for this slice.',
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
