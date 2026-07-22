import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RateMasterService } from '../rate-master/rate-master.service';
import { CreateShiftSalesSummaryDto } from './dto/create-shift-sales-summary.dto';
import { UpdateShiftSalesSummaryDto } from './dto/update-shift-sales-summary.dto';

// Section 8A.2 — ShiftSalesSummary: the aggregate walk-in (non-itemized)
// sales figure for a shift, parallel to itemized Bills, feeding the same
// kind of variance check as Section 3.3's meter-vs-billed flag but at the
// aggregate level. This is money-touching code (CLAUDE.md: human review
// flag before merge) — variance here is a live under/over-collection signal.
//
// KNOWN SCOPE GAP (same one MeterReadingsService.checkVariance() already
// flags): Bill has no nozzleId/shiftId FK, so "litres already billed for
// this shift" is approximated as bills entered by this shift's staffId
// within [shiftStart, shiftEnd] — not an exact per-nozzle match. Reusing the
// exact same approximation here (rather than inventing a second, possibly
// divergent one) keeps the two variance numbers at least internally
// consistent with each other.
@Injectable()
export class ShiftSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateMasterService: RateMasterService,
  ) {}

  async create(dto: CreateShiftSalesSummaryDto) {
    const existing = await this.prisma.shiftSalesSummary.findFirst({
      where: { shiftId: dto.shiftId },
    });
    if (existing) {
      throw new ConflictException(
        `A ShiftSalesSummary already exists for shift ${dto.shiftId} (id ${existing.id}) — use PATCH /shift-sales/${existing.id} to update it`,
      );
    }

    const reading = await this.prisma.meterReading.findUnique({
      where: { id: dto.shiftId },
    });
    if (!reading) {
      throw new NotFoundException(
        `MeterReading (shift) ${dto.shiftId} not found`,
      );
    }
    if (reading.closingReading === null || reading.shiftEnd === null) {
      throw new BadRequestException(
        `Shift ${dto.shiftId} is still open — close it (PATCH /meter-readings/${dto.shiftId}/close) before recording a walk-in sales summary`,
      );
    }
    if (!reading.productType) {
      throw new BadRequestException(
        `Shift ${dto.shiftId} has no productType recorded — cannot resolve a Rate Master entry to compute expected value`,
      );
    }

    const litresSoldFromMeter = reading.closingReading - reading.openingReading;

    // See the KNOWN SCOPE GAP comment above — same approximation as
    // MeterReadingsService.checkVariance().
    const billedAgg = await this.prisma.bill.aggregate({
      _sum: { litres: true },
      where: {
        enteredById: reading.staffId,
        timestamp: { gte: reading.shiftStart, lte: reading.shiftEnd },
        deletedAt: null,
      },
    });
    const litresBilled = billedAgg._sum.litres ?? 0;

    const rawWalkInLitres = litresSoldFromMeter - litresBilled;
    // JUDGMENT CALL: clamp a negative result at 0 rather than store/propagate
    // "litres sold to nobody" as a negative number — this can only happen
    // from the known approximation gap above (e.g. bills over-attributed to
    // this staff/window from a different nozzle). Surfaced via a warning
    // instead of silently absorbed, same style as MeterReadingsService's
    // tankWarning / BillsService's loyaltyWarning.
    const walkInLitres = Math.max(0, rawWalkInLitres);
    const negativeWalkInWarning =
      rawWalkInLitres < 0
        ? `Computed walk-in litres was negative (${rawWalkInLitres.toFixed(2)}) — litres billed against this shift's staff/window exceed litres sold per the meter reading; clamped to 0. See the known Bill/shift attribution approximation gap.`
        : undefined;

    const rate = await this.rateMasterService.getCurrentRate(
      reading.productType,
      reading.shiftEnd,
    );
    const expectedValue = walkInLitres * rate.rate;

    const walkInCashCollected = dto.walkInCashCollected ?? 0;
    const walkInCardCollected = dto.walkInCardCollected ?? 0;
    // walkInUpiCollected always starts at 0 on create — the webhook handler
    // is the only thing that ever increments it (see upi-webhook/).
    const variance =
      expectedValue - (walkInCashCollected + 0 + walkInCardCollected);

    const created = await this.prisma.shiftSalesSummary.create({
      data: {
        // Phase 0.3 (docs/multi-tenancy-plan.md) — pumpId is required now;
        // reuses the shift's own MeterReading.pumpId (already fetched
        // above) rather than requireTenantContext(), since this summary
        // belongs to whichever pump owns the shift it's about.
        pumpId: reading.pumpId,
        shiftId: dto.shiftId,
        dsmId: dto.dsmId ?? reading.staffId,
        nozzleId: dto.nozzleId ?? reading.nozzleId,
        walkInLitres,
        walkInCashCollected,
        walkInCardCollected,
        walkInUpiCollected: 0,
        expectedValue,
        variance,
      },
    });

    return negativeWalkInWarning
      ? { ...created, warning: negativeWalkInWarning }
      : created;
  }

  findAll() {
    return this.prisma.shiftSalesSummary.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const summary = await this.prisma.shiftSalesSummary.findUnique({
      where: { id },
    });
    if (!summary) {
      throw new NotFoundException(`ShiftSalesSummary ${id} not found`);
    }
    return summary;
  }

  // Update the manually-entered cash/card totals and recompute variance
  // against the CURRENT (DB-stored) walkInUpiCollected — never a
  // client-supplied one. See UpdateShiftSalesSummaryDto's comment for why
  // the DTO has no walkInUpiCollected field at all.
  async update(id: string, dto: UpdateShiftSalesSummaryDto) {
    const existing = await this.findOne(id);

    const walkInCashCollected =
      dto.walkInCashCollected ?? existing.walkInCashCollected;
    const walkInCardCollected =
      dto.walkInCardCollected ?? existing.walkInCardCollected;
    const variance =
      existing.expectedValue -
      (walkInCashCollected + existing.walkInUpiCollected + walkInCardCollected);

    return this.prisma.shiftSalesSummary.update({
      where: { id },
      data: { walkInCashCollected, walkInCardCollected, variance },
    });
  }

  // Section 8A.3 — called by UpiWebhookService inside its own transaction
  // (`tx`), so the UpiWebhookEvent create + this increment commit or roll
  // back together. Increments (never overwrites) walkInUpiCollected, since a
  // shift can receive multiple UPI payments across its duration, and
  // recomputes variance off the fresh total.
  //
  // Returns null if no ShiftSalesSummary row exists yet for this shift — see
  // upi-webhook.service.ts for why that's a deliberate "store the event,
  // skip the increment, leave it for later reconciliation" fallback rather
  // than an error.
  async incrementUpiForShift(
    tx: Prisma.TransactionClient,
    shiftId: string,
    amount: number,
  ) {
    const summary = await tx.shiftSalesSummary.findFirst({
      where: { shiftId },
    });
    if (!summary) {
      return null;
    }

    const walkInUpiCollected = summary.walkInUpiCollected + amount;
    const variance =
      summary.expectedValue -
      (summary.walkInCashCollected + walkInUpiCollected + summary.walkInCardCollected);

    return tx.shiftSalesSummary.update({
      where: { id: summary.id },
      data: { walkInUpiCollected, variance },
    });
  }
}
