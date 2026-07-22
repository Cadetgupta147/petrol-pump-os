import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CashCustodyLog, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { resolveAssignableActorId } from '../common/resolve-assignable-actor';
import { CreateCashCustodyLogDto } from './dto/create-cash-custody-log.dto';

// Section 8 — Day-End Cash Reconciliation & Custody. This is money-handling
// code (CLAUDE.md: cash custody logic needs a human review flag before
// merge) — correctness of the 3-way-split validation and the carry-forward
// math matters more than speed here.
//
// Auth: enforced at the controller level (global JwtAuthGuard + RolesGuard,
// see cash-custody.controller.ts).
const BALANCE_EPSILON = 0.01;

@Injectable()
export class CashCustodyService {
  constructor(private readonly prisma: PrismaService) {}

  // Section 8.1 step 1 (day-end 3-way split) + step 2 (next-day
  // "brought back" settlement) in one call — see the DTO's top comment for
  // why these aren't split into two endpoints/entities.
  // Finding A1 (docs/production-readiness.md) — handledById is resolved via
  // resolveAssignableActorId() (see that function's header comment): omitted
  // -> the caller; explicitly set to someone else -> allowed for non-DSM
  // callers only.
  async create(dto: CreateCashCustodyLogDto, user: AuthenticatedUser) {
    const handledById = resolveAssignableActorId(user, dto.handledById);

    // --- 3-way split validation (Section 8.1 step 1) ---
    // Enforced server-side per CLAUDE.md — never rely on the UI disabling a
    // Save button. Float-safe comparison via a small epsilon, same pattern
    // as BillsService.assertBalanced().
    const splitSum = dto.depositedToBank + dto.keptInLocker + dto.takenHome;
    if (Math.abs(splitSum - dto.totalCashCollected) > BALANCE_EPSILON) {
      throw new BadRequestException(
        `depositedToBank + keptInLocker + takenHome must equal totalCashCollected: ` +
          `${dto.depositedToBank} + ${dto.keptInLocker} + ${dto.takenHome} = ${splitSum.toFixed(2)}, ` +
          `but totalCashCollected = ${dto.totalCashCollected.toFixed(2)}`,
      );
    }

    const date = new Date(dto.date);

    // JUDGMENT CALL (not explicit in the spec): one entry per handledBy
    // staff member per day-end date. Without this, the same person could
    // submit multiple rows for the same date and silently multiply/hide
    // their carry-forward chain (each new row would resolve
    // cumulativeOutstandingBeforeToday off whichever row happened to be
    // "most recent", not off a single canonical day). Reject rather than silently overwrite
    // or allow — an accountant who needs to correct a mistake should use a
    // real edit endpoint (not implemented in this slice; append-only for
    // now, mirroring BillAuditLog/RateHistory's "correction is a new dated
    // row" philosophy) rather than have two same-day rows for one person.
    const duplicateForDate = await this.prisma.cashCustodyLog.findFirst({
      where: { handledById, date },
    });
    if (duplicateForDate) {
      throw new ConflictException(
        `A cash custody entry already exists for staff ${handledById} on ${dto.date} (id ${duplicateForDate.id})`,
      );
    }

    // --- Carry-forward resolution (Section 8.1 step 2) ---
    // cumulativeOutstandingBeforeToday is ALWAYS server-resolved, never
    // trusted from the client — resolved as this same staff member's most
    // recent PRIOR row's newOutstanding (strictly earlier date), or 0 if
    // this is their first-ever entry. Named "cumulative" (not "previous
    // day") because it's the running carried-through balance from the whole
    // chain, not literally the prior calendar day's figure.
    const priorLog = await this.prisma.cashCustodyLog.findFirst({
      where: { handledById, date: { lt: date } },
      orderBy: { date: 'desc' },
    });
    const cumulativeOutstandingBeforeToday = priorLog?.newOutstanding ?? 0;
    const broughtBackToday = dto.broughtBackToday ?? 0;

    // JUDGMENT CALL — clamping rule for
    // broughtBackToday > cumulativeOutstandingBeforeToday: REJECT (400)
    // rather than clamp. Clamping (silently treating anything over the
    // outstanding balance as if it were exactly the outstanding balance)
    // would let a data-entry error (or a deliberate attempt to hide a
    // shortfall) quietly disappear rather than surface. The formula below,
    // `newOutstanding = (cumulativeOutstandingBeforeToday - broughtBackToday) + takenHome`,
    // would also let an inflated broughtBackToday push the first term
    // negative, which could then silently cancel out a genuine new
    // takenHome amount from TODAY — i.e. a person could "launder" today's
    // shortfall by overstating what they brought back from a previous debt.
    // Rejecting forces a correction (or a fresh, honest entry) instead.
    if (broughtBackToday - cumulativeOutstandingBeforeToday > BALANCE_EPSILON) {
      throw new BadRequestException(
        `broughtBackToday (${broughtBackToday}) cannot exceed this person's cumulativeOutstandingBeforeToday (${cumulativeOutstandingBeforeToday})`,
      );
    }

    const newOutstanding =
      cumulativeOutstandingBeforeToday - broughtBackToday + dto.takenHome;

    try {
      return await this.prisma.cashCustodyLog.create({
        data: {
          date,
          totalCashCollected: dto.totalCashCollected,
          depositedToBank: dto.depositedToBank,
          keptInLocker: dto.keptInLocker,
          takenHome: dto.takenHome,
          cumulativeOutstandingBeforeToday,
          broughtBackToday,
          newOutstanding,
          handledById,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, handledById);
    }
  }

  findAll() {
    return this.prisma.cashCustodyLog.findMany({
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { handledBy: { select: { id: true, name: true } } },
    });
  }

  async findOne(id: string) {
    const log = await this.prisma.cashCustodyLog.findUnique({
      where: { id },
      include: { handledBy: { select: { id: true, name: true } } },
    });
    if (!log) {
      throw new NotFoundException(`CashCustodyLog ${id} not found`);
    }
    return log;
  }

  // Section 8.1 step 3 — "the single most useful report for keeping
  // day-to-day cash handling honest": per person, how much they're
  // currently holding outside the pump, and for how long.
  //
  // "How long" is computed as: the date of the earliest row in this
  // person's CURRENT unbroken run of newOutstanding > 0 rows (walking
  // backward from their latest entry). A row with newOutstanding === 0
  // resets the streak (they're settled up to that point) — so a person who
  // clears their balance and then takes home cash again the next day is
  // shown as "holding since" the new day, not since whenever they first
  // ever carried a balance.
  async getReport() {
    const staffList = await this.prisma.staff.findMany({
      where: { cashCustodyLogs: { some: {} } },
      select: {
        id: true,
        name: true,
        cashCustodyLogs: { orderBy: { date: 'asc' } },
      },
    });

    const now = new Date();
    const report = staffList.map((staff) => {
      const logs = staff.cashCustodyLogs;
      const latest = logs[logs.length - 1];

      let streakStart: Date | null = null;
      for (const log of logs) {
        if (log.newOutstanding > BALANCE_EPSILON) {
          if (streakStart === null) {
            streakStart = log.date;
          }
        } else {
          streakStart = null;
        }
      }

      const currentOutstanding = latest.newOutstanding;
      const isCurrentlyOutstanding = currentOutstanding > BALANCE_EPSILON;
      const daysHeld =
        isCurrentlyOutstanding && streakStart
          ? Math.max(
              0,
              Math.round(
                (now.getTime() - streakStart.getTime()) /
                  (1000 * 60 * 60 * 24),
              ),
            )
          : 0;

      return {
        staffId: staff.id,
        staffName: staff.name,
        currentOutstanding,
        isCurrentlyOutstanding,
        outstandingSinceDate: isCurrentlyOutstanding ? streakStart : null,
        daysHeld,
        lastEntryDate: latest.date,
      };
    });

    // Surface the biggest / longest-held outstanding balances first — this
    // is meant to be read top-down as "who to chase first", not a raw dump.
    return report.sort((a, b) => {
      if (a.isCurrentlyOutstanding !== b.isCurrentlyOutstanding) {
        return a.isCurrentlyOutstanding ? -1 : 1;
      }
      return b.currentOutstanding - a.currentOutstanding;
    });
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

// Re-exported only for the .spec.ts's type annotations on mocked Prisma
// return values.
export type { CashCustodyLog };
