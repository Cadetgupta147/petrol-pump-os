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
import { requireTenantContext } from '../common/tenant-context';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';

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
// no `nozzleId` or `shiftId` FK — there is no direct link from a Bill to the
// nozzle/shift it was entered against. checkVariance() approximates "litres
// billed during this shift" as: bills where `enteredById` matches this
// shift's `staffId` AND `timestamp` falls within [shiftStart, shiftEnd],
// excluding soft-deleted bills. This is an approximation, not an exact
// match — a DSM could plausibly bill for a different nozzle during their
// shift, or another staff member could cover the same nozzle while this
// shift is open, and either case would silently skew the variance number.
// Closing this properly requires a schema change (Bill.nozzleId or
// Bill.shiftId), which is out of scope for this slice.

// Section 3.3 doesn't specify a tolerance number for the variance flag.
// This is a placeholder constant — a dealer-configurable tolerance
// (mirroring the CreditConfig singleton pattern) would be a natural
// follow-up, but is out of scope for "a basic variance check endpoint."
const VARIANCE_TOLERANCE_LITRES = 0.5;

@Injectable()
export class MeterReadingsService {
  constructor(private readonly prisma: PrismaService) {}

  // Finding A1 — staffId is resolved via resolveAssignableActorId() (see
  // that function's header comment): omitted -> the caller; explicitly set
  // to someone else -> allowed for non-DSM callers only.
  async openShift(dto: OpenShiftDto, user: AuthenticatedUser) {
    const staffId = resolveAssignableActorId(user, dto.staffId);

    // Section 3.3/4 — nozzleId now must reference a real, active Nozzle
    // master row (see nozzles.service.ts) rather than being a free-typed
    // string a DSM could mistype.
    const nozzle = await this.prisma.nozzle.findUnique({
      where: { id: dto.nozzleId },
    });
    if (!nozzle || !nozzle.isActive) {
      throw new NotFoundException(
        `Nozzle ${dto.nozzleId} not found — pick a nozzle from the configured list (Settings).`,
      );
    }

    // A nozzle shouldn't have two concurrently-open shifts (closingReading
    // still null means the shift hasn't been closed out yet).
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
          staffId,
          openingReading,
          productType: nozzle.productType,
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
  async closeShift(id: string, dto: CloseShiftDto) {
    const existing = await this.prisma.meterReading.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`MeterReading ${id} not found`);
    }
    if (existing.closingReading !== null || existing.shiftEnd !== null) {
      throw new ConflictException(`MeterReading ${id} is already closed`);
    }
    if (dto.closingReading < existing.openingReading) {
      throw new BadRequestException(
        `closingReading (${dto.closingReading}) cannot be less than openingReading (${existing.openingReading}) — the meter only counts up`,
      );
    }

    const litresSold = dto.closingReading - existing.openingReading;

    const { updated, tankWarning } = await this.prisma.$transaction(
      async (tx) => {
        const updatedReading = await tx.meterReading.update({
          where: { id },
          data: {
            closingReading: dto.closingReading,
            shiftEnd: new Date(),
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

    const litresSoldFromMeter =
      reading.closingReading - reading.openingReading;

    // See the KNOWN SCOPE GAP comment at the top of this file: this is an
    // approximation of "litres billed during this shift", not an exact
    // match, because Bill has no nozzleId/shiftId FK.
    const billedAgg = await this.prisma.bill.aggregate({
      _sum: { litres: true },
      where: {
        enteredById: reading.staffId,
        timestamp: { gte: reading.shiftStart, lte: reading.shiftEnd },
        deletedAt: null,
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

  // litresSold is not persisted — computed on the fly from
  // closingReading - openingReading. null while the shift is still open.
  // Generic so the `nozzle` relation some call sites `include` (findAll/
  // findOne/openShift/closeShift) passes through untouched.
  private withComputedLitresSold<T extends MeterReading>(reading: T) {
    return {
      ...reading,
      litresSold:
        reading.closingReading !== null
          ? reading.closingReading - reading.openingReading
          : null,
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
    }
    throw error;
  }
}
