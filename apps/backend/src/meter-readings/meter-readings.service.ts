import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, MeterReading, Nozzle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { resolveAssignableActorId } from '../common/resolve-assignable-actor';
import { assertNonDsmOverride } from '../common/assert-non-dsm-override';
import { requireTenantContext } from '../common/tenant-context';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CorrectMeterReadingDto } from './dto/correct-meter-reading.dto';

// Section 3.3 — Meter Reading Management: opening/closing meter reading
// entry per nozzle per shift, auto-calculated litres sold, and a variance
// flag against billed litres. This is not itself money-touching in the
// CLAUDE.md sense (no amounts/points/cash custody here), but the variance
// check feeds directly into detecting under-billing/pilferage — treat any
// consuming feature (e.g. an automated alert) with the same care.
//
// Auth: enforced at the controller level (global JwtAuthGuard) — see
// meter-readings.controller.ts.
//
// Section 3.3/4 carry-forward rule (closes the "DSM shouldn't be able to
// change the opening meter reading" product gap): a nozzle's opening
// reading is never client-supplied. openShift() always derives it itself —
// the previous shift's closingReading if one exists, else the Nozzle's
// one-time startingReading (see resolveOpeningReading() below and the
// schema comment on Nozzle.startingReading).
//
// KNOWN SCOPE GAP (flagged per task spec, not silently resolved): `Bill` has
// an OPTIONAL `nozzleId` FK (added alongside this slice) but most entry
// points don't populate it yet — see CreateBillDto's comment. checkVariance()
// prefers an exact nozzleId match when a bill has one, and falls back to the
// old approximation (enteredById + shiftStart/shiftEnd time window) for
// bills that don't. Once every entry point sends nozzleId, the fallback
// branch becomes dead code that's safe to delete — not done here since that
// UI wiring is a separate, larger piece of work.
const VARIANCE_TOLERANCE_LITRES = 0.5;

@Injectable()
export class MeterReadingsService {
  constructor(private readonly prisma: PrismaService) {}

  // Finding A1 — staffId is resolved via resolveAssignableActorId() (see
  // that function's header comment): omitted -> the caller; explicitly set
  // to someone else -> allowed for non-DSM callers only.
  async openShift(dto: OpenShiftDto, user: AuthenticatedUser) {
    const staffId = resolveAssignableActorId(user, dto.staffId);

    let shiftStart: Date | undefined;
    if (dto.shiftStart !== undefined) {
      assertNonDsmOverride(user, 'shiftStart');
      shiftStart = new Date(dto.shiftStart);
      if (shiftStart.getTime() > Date.now()) {
        throw new BadRequestException('shiftStart cannot be in the future.');
      }
    }

    // Section 3.3/4 — nozzleId now must reference a real, active Nozzle
    // master row (see nozzles.service.ts) rather than being a free-typed
    // string a DSM could mistype.
    const nozzle = await this.prisma.nozzle.findUnique({
      where: { id: dto.nozzleId },
      include: { item: true },
    });
    if (!nozzle || !nozzle.isActive) {
      throw new NotFoundException(
        `Nozzle ${dto.nozzleId} not found — pick a nozzle from the configured list (Settings).`,
      );
    }

    // A nozzle shouldn't have two concurrently-open shifts (closingReading
    // still null means the shift hasn't been closed out yet). This
    // app-level check is backed up by a DB-level guarantee below
    // (openLockNozzleId's unique constraint) against the TOCTOU race of two
    // near-simultaneous requests both passing this check.
    const existingOpenShift = await this.prisma.meterReading.findFirst({
      where: { nozzleId: dto.nozzleId, closingReading: null },
    });
    if (existingOpenShift) {
      throw new ConflictException(
        `Nozzle ${dto.nozzleId} already has an open shift (meterReadingId: ${existingOpenShift.id}) — close it before opening a new one`,
      );
    }

    const openingReading = await this.resolveOpeningReading(nozzle);

    try {
      const created = await this.prisma.meterReading.create({
        data: {
          pumpId: requireTenantContext().pumpId,
          nozzleId: dto.nozzleId,
          openLockNozzleId: dto.nozzleId,
          staffId,
          openingReading,
          productType: nozzle.item.name,
          ...(shiftStart !== undefined && { shiftStart }),
        },
        include: { nozzle: true },
      });
      return this.withComputedLitresSold(created);
    } catch (error) {
      this.handlePrismaError(error, staffId);
    }
  }

  // Section 3.3/4 carry-forward rule: this nozzle's opening reading is this
  // nozzle's LAST CLOSED shift's closingReading, or Nozzle.startingReading if
  // it has never had a shift before. Never client-supplied — see
  // OpenShiftDto's comment for why. Mirrors NozzlesService's own
  // withNextOpeningReading() (kept separate rather than shared: that one is
  // a read-only preview allowed to run even with an open shift in progress,
  // this one only ever runs after openShift() has already confirmed there
  // is NO open shift for this nozzle).
  private async resolveOpeningReading(nozzle: Nozzle): Promise<number> {
    const lastClosed = await this.prisma.meterReading.findFirst({
      where: { nozzleId: nozzle.id, closingReading: { not: null } },
      orderBy: { shiftEnd: 'desc' },
    });
    return lastClosed?.closingReading ?? nozzle.startingReading;
  }

  // Section 7.2 step 2 — every nozzle sale (from meter reading) auto-deducts
  // the matching tank, in the same transaction as the closingReading/shiftEnd
  // update.
  //
  // ASYMMETRY vs PurchasesService.create()'s hard-block-on-missing-Tank
  // (documented there too, read both comments together): if this shift has
  // no productType (a legacy row from before Section 7.2, since
  // MeterReading.productType is nullable precisely to avoid a migration
  // backfill) or no Tank matches it, we do NOT block the shift close — a DSM
  // must always be able to close their shift and go home regardless of
  // whether back-office inventory setup is complete. Instead the response
  // carries a `tankWarning` field, in the same shape/spirit as
  // BillsService.create()'s `loyaltyWarning`: the operation still succeeds,
  // but the gap is surfaced loudly rather than silently absorbed. Contrast
  // with PurchasesService, where a deliberate accounting action (recording a
  // delivery) IS hard-blocked without a matching Tank, because letting a real
  // delivery go unrecorded against inventory would be worse than blocking it
  // — closing a shift has no equivalent "just don't do it" option.
  async closeShift(id: string, dto: CloseShiftDto, user: AuthenticatedUser) {
    const existing = await this.prisma.meterReading.findUnique({
      where: { id },
      include: { nozzle: true },
    });
    if (!existing) {
      throw new NotFoundException(`MeterReading ${id} not found`);
    }
    if (existing.closingReading !== null || existing.shiftEnd !== null) {
      throw new ConflictException(`MeterReading ${id} is already closed`);
    }

    // Rollover handling (a physical meter resetting to zero) — see the
    // schema comment on Nozzle.rolloverAt. Below openingReading is only
    // ever legitimate with BOTH meterRolledOver:true AND a configured
    // rolloverAt; above (or equal to) openingReading, meterRolledOver makes
    // no sense (nothing rolled over) and is rejected rather than silently
    // ignored.
    if (dto.closingReading < existing.openingReading) {
      if (!dto.meterRolledOver) {
        throw new BadRequestException(
          `closingReading (${dto.closingReading}) cannot be less than openingReading (${existing.openingReading}) — the meter only counts up. If this nozzle's meter physically rolled over to zero mid-shift, resubmit with meterRolledOver: true.`,
        );
      }
      if (existing.nozzle.rolloverAt == null) {
        throw new BadRequestException(
          `Nozzle ${existing.nozzleId} has no configured rollover point (Nozzle.rolloverAt) — set one in Settings before closing a shift across a meter rollover.`,
        );
      }
    } else if (dto.meterRolledOver) {
      throw new BadRequestException(
        `meterRolledOver was set but closingReading (${dto.closingReading}) is not less than openingReading (${existing.openingReading}) — there's nothing to roll over here.`,
      );
    }

    let shiftEnd = new Date();
    if (dto.shiftEnd !== undefined) {
      assertNonDsmOverride(user, 'shiftEnd');
      shiftEnd = new Date(dto.shiftEnd);
      if (shiftEnd.getTime() < existing.shiftStart.getTime()) {
        throw new BadRequestException(
          `shiftEnd cannot be before this shift's shiftStart (${existing.shiftStart.toISOString()}).`,
        );
      }
      if (shiftEnd.getTime() > Date.now()) {
        throw new BadRequestException('shiftEnd cannot be in the future.');
      }
    }

    const meterRolledOver = dto.meterRolledOver ?? false;
    const litresSold = this.computeLitresSold(
      existing.openingReading,
      dto.closingReading,
      meterRolledOver,
      existing.nozzle.rolloverAt,
    ) as number; // never null here — dto.closingReading is always provided

    const { updated, tankWarning } = await this.prisma.$transaction(
      async (tx) => {
        const updatedReading = await tx.meterReading.update({
          where: { id },
          data: {
            closingReading: dto.closingReading,
            shiftEnd,
            meterRolledOver,
            openLockNozzleId: null,
          },
          include: { nozzle: true },
        });

        let warning: string | undefined;
        if (!existing.productType) {
          warning =
            'This shift has no productType recorded (legacy shift) — tank stock was not auto-deducted.';
        } else {
          const tank = await tx.tank.findFirst({
            where: { productType: existing.productType },
          });
          if (!tank) {
            warning = `No tank configured for product ${existing.productType} — tank stock was not auto-deducted.`;
          } else {
            await tx.tank.update({
              where: { id: tank.id },
              data: { currentStockLitres: { decrement: litresSold } },
            });
          }
        }

        return { updated: updatedReading, tankWarning: warning };
      },
    );

    const withLitres = this.withComputedLitresSold(updated);
    return tankWarning ? { ...withLitres, tankWarning } : withLitres;
  }

  // PATCH /meter-readings/:id/correct — Owner/Accountant only (see
  // meter-readings.controller.ts; no extra @Roles needed there, the
  // controller's class-level default already matches). Closes the "manual
  // entry option ... for corrections" gap Section 3.3 always described but
  // never had an actual edit path for — see CorrectMeterReadingDto's
  // comment for the exact rules this enforces.
  async correctMeterReading(id: string, dto: CorrectMeterReadingDto, staffId: string) {
    if (dto.openingReading === undefined && dto.closingReading === undefined) {
      throw new BadRequestException(
        'Provide at least one of openingReading/closingReading to correct.',
      );
    }

    const existing = await this.prisma.meterReading.findUnique({
      where: { id },
      include: { nozzle: true },
    });
    if (!existing) {
      throw new NotFoundException(`MeterReading ${id} not found`);
    }

    // openingReading is carry-forward derived from the PREVIOUS shift for
    // every reading except a nozzle's very first — correcting it directly
    // only makes sense there; everywhere else, the previous shift's
    // closingReading is the real source of truth to fix instead.
    if (dto.openingReading !== undefined) {
      const earlierReading = await this.prisma.meterReading.findFirst({
        where: { nozzleId: existing.nozzleId, shiftStart: { lt: existing.shiftStart } },
      });
      if (earlierReading) {
        throw new BadRequestException(
          `MeterReading ${id} is not nozzle ${existing.nozzleId}'s first-ever shift — its opening reading is carried forward from the previous shift's closing reading (meterReadingId: ${earlierReading.id}). Correct that shift's closingReading instead.`,
        );
      }
    }

    // closingReading can only be corrected once a shift is actually closed
    // — an open shift has no closing reading yet (use PATCH .../close).
    if (dto.closingReading !== undefined && existing.closingReading === null) {
      throw new BadRequestException(
        `MeterReading ${id} is still open — use PATCH /meter-readings/:id/close to close it, not this correction endpoint.`,
      );
    }

    // Bounded cascade: at most one shift forward. If a chronologically
    // later shift on this nozzle exists and is ALSO already closed, block
    // the correction outright rather than silently leaving its
    // (now-stale) openingReading unreconciled — the accountant should
    // correct the chain starting from its earliest wrong shift instead.
    let nextShift: MeterReading | null = null;
    if (dto.closingReading !== undefined) {
      nextShift = await this.prisma.meterReading.findFirst({
        where: { nozzleId: existing.nozzleId, shiftStart: { gt: existing.shiftStart } },
        orderBy: { shiftStart: 'asc' },
      });
      if (nextShift && nextShift.closingReading !== null) {
        throw new ConflictException(
          `A later shift on this nozzle (meterReadingId: ${nextShift.id}) is already closed too — correct the chain starting from the earliest wrong shift instead of this one.`,
        );
      }
    }

    const newOpeningReading = dto.openingReading ?? existing.openingReading;
    const newClosingReading = dto.closingReading ?? existing.closingReading;

    const oldLitresSold = this.computeLitresSold(
      existing.openingReading,
      existing.closingReading,
      existing.meterRolledOver,
      existing.nozzle.rolloverAt,
    );
    const newLitresSold = this.computeLitresSold(
      newOpeningReading,
      newClosingReading,
      existing.meterRolledOver,
      existing.nozzle.rolloverAt,
    );

    const { updated, tankWarning } = await this.prisma.$transaction(async (tx) => {
      const updatedReading = await tx.meterReading.update({
        where: { id },
        data: {
          openingReading: newOpeningReading,
          closingReading: newClosingReading,
          correctedById: staffId,
          correctedAt: new Date(),
        },
        include: { nozzle: true },
      });

      let warning: string | undefined;
      if (dto.closingReading !== undefined && oldLitresSold !== null && newLitresSold !== null) {
        const delta = newLitresSold - oldLitresSold;
        if (delta !== 0) {
          if (!existing.productType) {
            warning =
              'This shift has no productType recorded — tank stock was not adjusted for this correction.';
          } else {
            const tank = await tx.tank.findFirst({ where: { productType: existing.productType } });
            if (!tank) {
              warning = `No tank configured for product ${existing.productType} — tank stock was not adjusted for this correction.`;
            } else {
              await tx.tank.update({
                where: { id: tank.id },
                data: { currentStockLitres: { decrement: delta } },
              });
            }
          }
        }
      }

      // Keep the carry-forward chain consistent: if the immediate next
      // shift on this nozzle is still open, its openingReading was derived
      // from this shift's OLD closingReading — repoint it at the new one.
      if (nextShift && dto.closingReading !== undefined) {
        await tx.meterReading.update({
          where: { id: nextShift.id },
          data: { openingReading: newClosingReading! },
        });
      }

      return { updated: updatedReading, tankWarning: warning };
    });

    const withLitres = this.withComputedLitresSold(updated);
    return tankWarning ? { ...withLitres, tankWarning } : withLitres;
  }

  async findAll() {
    // Section 3.3/4 — nozzle included so callers (web portal table, DSM
    // app) can show the dealer-facing label/productType instead of a raw
    // FK id, without a second round trip per row.
    const readings = await this.prisma.meterReading.findMany({
      orderBy: { shiftStart: 'desc' },
      include: { nozzle: true },
    });
    return readings.map((reading) => this.withComputedLitresSold(reading));
  }

  async findOne(id: string) {
    const reading = await this.prisma.meterReading.findUnique({
      where: { id },
      include: { nozzle: true },
    });
    if (!reading) {
      throw new NotFoundException(`MeterReading ${id} not found`);
    }
    return this.withComputedLitresSold(reading);
  }

  async checkVariance(id: string) {
    const reading = await this.prisma.meterReading.findUnique({
      where: { id },
      include: { nozzle: true },
    });
    if (!reading) {
      throw new NotFoundException(`MeterReading ${id} not found`);
    }
    if (reading.closingReading === null || reading.shiftEnd === null) {
      throw new BadRequestException(
        `MeterReading ${id} is still open — variance can't be evaluated until the shift is closed`,
      );
    }

    const litresSoldFromMeter = this.computeLitresSold(
      reading.openingReading,
      reading.closingReading,
      reading.meterRolledOver,
      reading.nozzle.rolloverAt,
    ) as number;

    // See the KNOWN SCOPE GAP comment at the top of this file: Bill.nozzleId
    // is optional and not every entry point populates it yet, so this
    // prefers an exact nozzle match (precise) and falls back to the
    // pre-existing staffId + time-window approximation for bills that
    // don't have one (unchanged behavior for those).
    const billedAgg = await this.prisma.bill.aggregate({
      _sum: { litres: true },
      where: {
        timestamp: { gte: reading.shiftStart, lte: reading.shiftEnd },
        deletedAt: null,
        OR: [
          { nozzleId: reading.nozzleId },
          { nozzleId: null, enteredById: reading.staffId },
        ],
      },
    });
    const litresBilled = billedAgg._sum.litres ?? 0;

    const variance = litresSoldFromMeter - litresBilled;
    const flagged = Math.abs(variance) > VARIANCE_TOLERANCE_LITRES;

    return {
      meterReadingId: reading.id,
      nozzleId: reading.nozzleId,
      nozzleLabel: reading.nozzle.label,
      staffId: reading.staffId,
      shiftStart: reading.shiftStart,
      shiftEnd: reading.shiftEnd,
      litresSoldFromMeter,
      litresBilled,
      variance,
      toleranceLitres: VARIANCE_TOLERANCE_LITRES,
      flagged,
    };
  }

  // Rollover-aware litres calculation shared by closeShift(), the
  // correction endpoint, and checkVariance(). null only when closingReading
  // itself is null (shift still open) — see each call site's cast/guard.
  private computeLitresSold(
    openingReading: number,
    closingReading: number | null,
    meterRolledOver: boolean,
    rolloverAt: number | null,
  ): number | null {
    if (closingReading === null) return null;
    if (meterRolledOver && rolloverAt != null) {
      return rolloverAt - openingReading + closingReading;
    }
    return closingReading - openingReading;
  }

  // litresSold is not persisted — computed on the fly (rollover-aware, see
  // computeLitresSold()). null while the shift is still open. Generic so
  // the `nozzle` relation every call site `include`s (findAll/findOne/
  // openShift/closeShift/correctMeterReading) passes through untouched —
  // also means TypeScript enforces that nozzle is always included wherever
  // this is called, since the calculation needs nozzle.rolloverAt.
  private withComputedLitresSold<T extends MeterReading & { nozzle: Nozzle }>(reading: T) {
    return {
      ...reading,
      litresSold: this.computeLitresSold(
        reading.openingReading,
        reading.closingReading,
        reading.meterRolledOver,
        reading.nozzle.rolloverAt,
      ),
    };
  }

  private handlePrismaError(error: unknown, staffId: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        // Foreign key violation — staffId doesn't reference a real Staff row.
        throw new BadRequestException(
          `${staffId} does not reference an existing Staff record`,
        );
      }
      if (error.code === 'P2002') {
        // openLockNozzleId's unique constraint — the DB-level backstop
        // against two near-simultaneous openShift() calls both passing the
        // app-level "already has an open shift" check above (see the schema
        // comment on MeterReading.openLockNozzleId).
        throw new ConflictException(
          'This nozzle already has an open shift — close it before opening a new one',
        );
      }
    }
    throw error;
  }
}
