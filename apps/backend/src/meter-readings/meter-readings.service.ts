import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, MeterReading } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';

// Section 3.3 — Meter Reading Management: opening/closing meter reading
// entry per nozzle per shift, auto-calculated litres sold, and a variance
// flag against billed litres. This is not itself money-touching in the
// CLAUDE.md sense (no amounts/points/cash custody here), but the variance
// check feeds directly into detecting under-billing/pilferage — treat any
// consuming feature (e.g. an automated alert) with the same care.
//
// NO AUTH/ROLE GUARDS YET — same gap as BillsController/CustomersController.
// Every endpoint below is currently open to anyone who can reach the API.
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

  async openShift(dto: OpenShiftDto) {
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

    try {
      const created = await this.prisma.meterReading.create({
        data: {
          nozzleId: dto.nozzleId,
          staffId: dto.staffId,
          openingReading: dto.openingReading,
        },
      });
      return this.withComputedLitresSold(created);
    } catch (error) {
      this.handlePrismaError(error, dto.staffId);
    }
  }

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

    const updated = await this.prisma.meterReading.update({
      where: { id },
      data: {
        closingReading: dto.closingReading,
        shiftEnd: new Date(),
      },
    });
    return this.withComputedLitresSold(updated);
  }

  async findAll() {
    const readings = await this.prisma.meterReading.findMany({
      orderBy: { shiftStart: 'desc' },
    });
    return readings.map((reading) => this.withComputedLitresSold(reading));
  }

  async findOne(id: string) {
    const reading = await this.prisma.meterReading.findUnique({
      where: { id },
    });
    if (!reading) {
      throw new NotFoundException(`MeterReading ${id} not found`);
    }
    return this.withComputedLitresSold(reading);
  }

  async checkVariance(id: string) {
    const reading = await this.prisma.meterReading.findUnique({
      where: { id },
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
  private withComputedLitresSold(reading: MeterReading) {
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
