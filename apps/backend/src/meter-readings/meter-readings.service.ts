import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, MeterReading, Nozzle, Item } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { resolveAssignableActorId } from '../common/resolve-assignable-actor';
import { assertNonDsmOverride } from '../common/assert-non-dsm-override';
import { requireTenantContext } from '../common/tenant-context';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CorrectMeterReadingDto } from './dto/correct-meter-reading.dto';
import { BatchCloseDto } from './dto/batch-close.dto';

// Shared shape for the nozzle relation every meter-reading query includes —
// used to type the tx-parameterized helpers below (resolveOpeningReading()/
// closeOneReading()) that both closeShift() (passing `this.prisma`) and
// batchClose() (passing its transaction's `tx`) call identically.
type NozzleWithItem = Nozzle & { item: Item };
type MeterReadingWithNozzle = MeterReading & { nozzle: NozzleWithItem };
type MeterReadingWithLitres = MeterReadingWithNozzle & { litresSold: number | null };

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

    const openingReading = await this.resolveOpeningReading(nozzle, this.prisma);

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
        include: { nozzle: { include: { item: true } } },
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
  // this one only ever runs after confirming there is NO open shift for this
  // nozzle).
  //
  // Takes the Prisma client explicitly (rather than always using
  // `this.prisma`) so batchClose() can call this identical logic from
  // inside its own `$transaction`'s `tx` — see that method's comment for why
  // this can't just call openShift() directly.
  private async resolveOpeningReading(
    nozzle: Nozzle,
    client: Prisma.TransactionClient,
  ): Promise<number> {
    const lastClosed = await client.meterReading.findFirst({
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
      include: { nozzle: { include: { item: true } } },
    });
    if (!existing) {
      throw new NotFoundException(`MeterReading ${id} not found`);
    }
    if (existing.closingReading !== null || existing.shiftEnd !== null) {
      throw new ConflictException(`MeterReading ${id} is already closed`);
    }

    let shiftEnd: Date | undefined;
    if (dto.shiftEnd !== undefined) {
      assertNonDsmOverride(user, 'shiftEnd');
      shiftEnd = new Date(dto.shiftEnd);
    }

    const { updated, tankWarning } = await this.prisma.$transaction(async (tx) =>
      this.closeOneReading(
        existing,
        { closingReading: dto.closingReading, meterRolledOver: dto.meterRolledOver, shiftEnd },
        tx,
      ),
    );

    const withLitres = this.withComputedLitresSold(updated);
    return tankWarning ? { ...withLitres, tankWarning } : withLitres;
  }

  // Section 7.2 step 2's actual close+tank-auto-deduct logic, extracted so
  // both closeShift() (passing `this.prisma`, wrapped in its own single-
  // reading `$transaction`) and batchClose() (passing its own transaction's
  // `tx`, covering every nozzle in the batch) run the IDENTICAL code path —
  // see batchClose()'s comment for why calling closeShift() itself from
  // inside a shared transaction isn't possible.
  //
  // shiftEnd defaults to now() when omitted (batchClose() never passes one —
  // there is no backdating override on the batch DTO, matching the product
  // decision that exact clock-time precision doesn't matter for this
  // feature). The shiftEnd-in-the-future / shiftEnd-before-shiftStart checks
  // live here (pure value validation, no user-role dependency) rather than
  // in closeShift(), unlike the assertNonDsmOverride() check above, which
  // stays there since only closeShift()'s single-reading DTO ever offers a
  // backdated shiftEnd at all.
  private async closeOneReading(
    existing: MeterReadingWithNozzle,
    input: { closingReading: number; meterRolledOver?: boolean; shiftEnd?: Date },
    client: Prisma.TransactionClient,
  ): Promise<{ updated: MeterReadingWithNozzle; tankWarning?: string }> {
    // Rollover handling (a physical meter resetting to zero) — see the
    // schema comment on Nozzle.rolloverAt. Below openingReading is only
    // ever legitimate with BOTH meterRolledOver:true AND a configured
    // rolloverAt; above (or equal to) openingReading, meterRolledOver makes
    // no sense (nothing rolled over) and is rejected rather than silently
    // ignored.
    if (input.closingReading < existing.openingReading) {
      if (!input.meterRolledOver) {
        throw new BadRequestException(
          `closingReading (${input.closingReading}) cannot be less than openingReading (${existing.openingReading}) — the meter only counts up. If this nozzle's meter physically rolled over to zero mid-shift, resubmit with meterRolledOver: true.`,
        );
      }
      if (existing.nozzle.rolloverAt == null) {
        throw new BadRequestException(
          `Nozzle ${existing.nozzleId} has no configured rollover point (Nozzle.rolloverAt) — set one in Settings before closing a shift across a meter rollover.`,
        );
      }
    } else if (input.meterRolledOver) {
      throw new BadRequestException(
        `meterRolledOver was set but closingReading (${input.closingReading}) is not less than openingReading (${existing.openingReading}) — there's nothing to roll over here.`,
      );
    }

    const shiftEnd = input.shiftEnd ?? new Date();
    if (shiftEnd.getTime() < existing.shiftStart.getTime()) {
      throw new BadRequestException(
        `shiftEnd cannot be before this shift's shiftStart (${existing.shiftStart.toISOString()}).`,
      );
    }
    if (shiftEnd.getTime() > Date.now()) {
      throw new BadRequestException('shiftEnd cannot be in the future.');
    }

    const meterRolledOver = input.meterRolledOver ?? false;
    const litresSold = this.computeLitresSold(
      existing.openingReading,
      input.closingReading,
      meterRolledOver,
      existing.nozzle.rolloverAt,
    ) as number; // never null here — input.closingReading is always provided

    const updatedReading = await client.meterReading.update({
      where: { id: existing.id },
      data: {
        closingReading: input.closingReading,
        shiftEnd,
        meterRolledOver,
        openLockNozzleId: null,
      },
      include: { nozzle: { include: { item: true } } },
    });

    let tankWarning: string | undefined;
    if (!existing.productType) {
      tankWarning =
        'This shift has no productType recorded (legacy shift) — tank stock was not auto-deducted.';
    } else {
      const tank = await client.tank.findFirst({
        where: { productType: existing.productType },
      });
      if (!tank) {
        tankWarning = `No tank configured for product ${existing.productType} — tank stock was not auto-deducted.`;
      } else {
        await client.tank.update({
          where: { id: tank.id },
          data: { currentStockLitres: { decrement: litresSold } },
        });
      }
    }

    return { updated: updatedReading, tankWarning };
  }

  // POST /meter-readings/batch-close — Meter Reading redesign (Section 3.3).
  // Replaces the old two-step "Open Shift" then "Close Shift" DSM flow: a
  // caller submits closing readings for every nozzle they're covering at
  // once, and this does — per nozzle, inside ONE shared transaction — what
  // openShift()+closeShift() already do:
  //   1. Resolve staffId via resolveAssignableActorId() (same as every other
  //      assignable-actor field in this codebase).
  //   2. If this nozzle currently has no open shift (first-ever entry, or
  //      nothing auto-reopened since the last MANUAL close via
  //      CloseShiftModal — see below), auto-create one first, using the
  //      exact same carry-forward + productType derivation openShift() uses.
  //   3. Close it via closeOneReading() (shared with closeShift()).
  //   4. Immediately auto-open the NEXT shift for this nozzle — openingReading
  //      = the closingReading just submitted, shiftStart = now() — so the
  //      nozzle is always left in "has exactly one open shift" state,
  //      preserving openLockNozzleId's DB-level guarantee with no schema
  //      change to MeterReading itself.
  //
  // IMPORTANT: this cannot just call this.openShift()/this.closeShift() —
  // both are hard-wired to `this.prisma`, and closeShift() opens its OWN
  // inner `$transaction`. Calling them from inside this method's outer `tx`
  // would run two uncoordinated transactions, breaking the atomicity a
  // batch needs (a failure on nozzle 3 must roll back nozzles 1-2 too) and
  // risking deadlocks under Postgres row locking. Instead, both this method
  // and closeShift() call the same tx-parameterized private helpers
  // (resolveOpeningReading(), closeOneReading()) — the one true code path.
  //
  // The kept-as-is manual closeShift() (Owner/Accountant/Manager fallback,
  // web portal's CloseShiftModal) does NOT auto-reopen the next shift — so
  // step 2's auto-create-if-missing branch is load-bearing every time a
  // manual close happens in between batch runs, not just a first-run edge
  // case.
  //
  // One failure anywhere in the batch (e.g. a bad rollover input on one
  // nozzle) aborts the WHOLE transaction — the thrown exception (already
  // nozzle-specific, e.g. "Nozzle X not found...") propagates out of the
  // `$transaction` callback and rolls everything back, exactly like any
  // other exception thrown inside this codebase's existing multi-step
  // transactions.
  async batchClose(dto: BatchCloseDto, user: AuthenticatedUser) {
    const pumpId = requireTenantContext().pumpId;

    return this.prisma.$transaction(
      async (tx) => {
        const results: Array<MeterReadingWithLitres & { tankWarning?: string }> = [];

        for (const entry of dto.readings) {
          let staffId: string | undefined;
          try {
            staffId = resolveAssignableActorId(user, entry.staffId);

            const nozzle = await tx.nozzle.findUnique({
              where: { id: entry.nozzleId },
              include: { item: true },
            });
            if (!nozzle || !nozzle.isActive) {
              throw new NotFoundException(
                `Nozzle ${entry.nozzleId} not found — pick a nozzle from the configured list (Settings).`,
              );
            }

            let existing = await tx.meterReading.findFirst({
              where: { nozzleId: entry.nozzleId, closingReading: null },
              include: { nozzle: { include: { item: true } } },
            });

            if (!existing) {
              const openingReading = await this.resolveOpeningReading(nozzle, tx);
              existing = await tx.meterReading.create({
                data: {
                  pumpId,
                  nozzleId: entry.nozzleId,
                  openLockNozzleId: entry.nozzleId,
                  staffId,
                  openingReading,
                  productType: nozzle.item.name,
                },
                include: { nozzle: { include: { item: true } } },
              });
            }

            const { updated, tankWarning } = await this.closeOneReading(
              existing,
              { closingReading: entry.closingReading, meterRolledOver: entry.meterRolledOver },
              tx,
            );

            // Auto-reopen — see this method's class-level comment. Only
            // reachable once closeOneReading() above has already nulled out
            // `updated`'s openLockNozzleId, so this create() never collides
            // with the unique constraint it just freed.
            await tx.meterReading.create({
              data: {
                pumpId,
                nozzleId: entry.nozzleId,
                openLockNozzleId: entry.nozzleId,
                staffId,
                openingReading: entry.closingReading,
                productType: nozzle.item.name,
              },
            });

            const withLitres = this.withComputedLitresSold(updated);
            results.push(tankWarning ? { ...withLitres, tankWarning } : withLitres);
          } catch (error) {
            this.handlePrismaError(error, staffId ?? entry.staffId ?? user.staffId);
          }
        }

        return results;
      },
      // A batch can cover many nozzles, each needing several sequential
      // round trips (nozzle lookup, open-shift lookup, maybe an auto-open
      // create, the close update, a tank lookup/update, the auto-reopen
      // create) — over a remote connection (Supabase, not localhost) that
      // can comfortably exceed Prisma's default 5s interactive-transaction
      // timeout once there's more than a couple of nozzles, throwing an
      // unhandled P2028 that isn't one of the two codes handlePrismaError()
      // recognizes (surfaces as a bare 500 instead of a real error). No
      // other transaction in this codebase loops over a caller-controlled
      // list like this, so none of them needed this override.
      { timeout: 30_000 },
    );
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
      include: { nozzle: { include: { item: true } } },
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
        include: { nozzle: { include: { item: true } } },
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

  // staffId is an optional filter — Owner/Accountant may pass it or omit it
  // (omitted = every reading, the existing behavior). The controller forces
  // it to the caller's own staffId for a DSM caller regardless of what (if
  // anything) was passed, so a DSM can see their own shift history (needed
  // for the DSM app's shift-summary screen) without ever being able to
  // enumerate any other staff member's readings.
  async findAll(staffId?: string) {
    // Section 3.3/4 — nozzle included so callers (web portal table, DSM
    // app) can show the dealer-facing label/productType instead of a raw
    // FK id, without a second round trip per row.
    const readings = await this.prisma.meterReading.findMany({
      where: staffId ? { staffId } : undefined,
      orderBy: { shiftStart: 'desc' },
      include: { nozzle: { include: { item: true } } },
    });
    return readings.map((reading) => this.withComputedLitresSold(reading));
  }

  async findOne(id: string) {
    const reading = await this.prisma.meterReading.findUnique({
      where: { id },
      include: { nozzle: { include: { item: true } } },
    });
    if (!reading) {
      throw new NotFoundException(`MeterReading ${id} not found`);
    }
    return this.withComputedLitresSold(reading);
  }

  // Section 8A.2 fix — this used to compare the meter's litresSold against
  // ONLY itemized Bill.litres, which meant any pump with real walk-in cash
  // trade (fuel sold without an individual Bill record) would show a
  // permanent, large "variance" that was never actually fraud — just
  // ordinary uncaptured walk-in volume. ShiftSalesSummary (Section 8A.2)
  // already computes that exact same gap independently, as `walkInLitres`,
  // whenever a shift's walk-in sales get reconciled — this now nets that
  // out before flagging, instead of double-counting it as unexplained.
  //
  // Direction matters: a NEGATIVE gap (more billed than the meter shows was
  // physically dispensed) can never be explained by walk-in volume — walk-in
  // only ever ADDS unbilled litres on top of what's billed, it can't make
  // billed litres exceed metered ones. That direction stays flagged
  // regardless of whether a ShiftSalesSummary exists.
  //
  // A POSITIVE gap with no ShiftSalesSummary yet is NOT flagged as fraud —
  // `reconciliationPending: true` is a reminder to log the walk-in summary
  // (Section 8A.2), not an accusation. Once that summary exists, the
  // leftover after netting it out is what actually gets flagged.
  async checkVariance(id: string) {
    const reading = await this.prisma.meterReading.findUnique({
      where: { id },
      include: { nozzle: { include: { item: true } } },
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
    const rawGap = litresSoldFromMeter - litresBilled;

    let walkInLitresReconciled: number | null = null;
    let variance = rawGap;
    let flagged: boolean;
    let reconciliationPending = false;

    if (rawGap < -VARIANCE_TOLERANCE_LITRES) {
      flagged = true;
    } else {
      const walkInSummary = await this.prisma.shiftSalesSummary.findFirst({
        where: { shiftId: reading.id },
      });
      if (walkInSummary) {
        walkInLitresReconciled = walkInSummary.walkInLitres;
        variance = rawGap - walkInSummary.walkInLitres;
        flagged = Math.abs(variance) > VARIANCE_TOLERANCE_LITRES;
      } else {
        flagged = false;
        reconciliationPending = rawGap > VARIANCE_TOLERANCE_LITRES;
      }
    }

    return {
      meterReadingId: reading.id,
      nozzleId: reading.nozzleId,
      nozzleLabel: reading.nozzle.label,
      staffId: reading.staffId,
      shiftStart: reading.shiftStart,
      shiftEnd: reading.shiftEnd,
      litresSoldFromMeter,
      litresBilled,
      walkInLitresReconciled,
      variance,
      toleranceLitres: VARIANCE_TOLERANCE_LITRES,
      flagged,
      reconciliationPending,
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
