import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Nozzle, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { CreateNozzleDto } from './dto/create-nozzle.dto';
import { UpdateNozzleDto } from './dto/update-nozzle.dto';

// Section 3.3/4 — Nozzle master: the Settings-level "how many nozzles/meters
// does this pump actually have" configuration, closing the gap flagged
// throughout meter-readings/tanks (see prisma/schema.prisma's Nozzle
// comment). Deliberately just a flat, dealer-managed list scoped to the
// tenant pump — no fixed count baked in anywhere, since different pumps have
// different physical nozzle/gun counts. Every nozzle picker (DSM app shift
// start/close, web portal meter-readings filters/forms) reads
// findAll()/findOne() here instead of accepting a free-typed nozzle id.
//
// Auth: enforced at the controller level (global JwtAuthGuard + RolesGuard,
// see nozzles.controller.ts) — create/update are Owner/Accountant only,
// reads additionally allow DSM (populating their own dropdown).
@Injectable()
export class NozzlesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateNozzleDto) {
    try {
      const created = await this.prisma.nozzle.create({
        data: {
          pumpId: requireTenantContext().pumpId,
          label: dto.label.trim(),
          itemId: dto.itemId,
          startingReading: dto.startingReading,
          rolloverAt: dto.rolloverAt,
        },
        include: { item: true },
      });
      return this.withNextOpeningReading(created);
    } catch (error) {
      this.handlePrismaError(error, dto.label);
    }
  }

  // includeInactive is false by default — that's what every real nozzle
  // PICKER (DSM app shift start, web portal meter-reading forms) should get.
  // The Nozzle Settings screen passes true so a disabled nozzle can still be
  // found and re-enabled — otherwise disabling a nozzle would make it
  // permanently unreachable through the UI (there'd be no way to ever list
  // it again to flip isActive back to true).
  async findAll(includeInactive = false) {
    const nozzles = await this.prisma.nozzle.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { label: 'asc' },
      include: { item: true },
    });
    return Promise.all(nozzles.map((nozzle) => this.withNextOpeningReading(nozzle)));
  }

  async findOne(id: string) {
    const nozzle = await this.prisma.nozzle.findUnique({
      where: { id },
      include: { item: true },
    });
    if (!nozzle) {
      throw new NotFoundException(`Nozzle ${id} not found`);
    }
    return this.withNextOpeningReading(nozzle);
  }

  async update(id: string, dto: UpdateNozzleDto) {
    const existing = await this.prisma.nozzle.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Nozzle ${id} not found`);
    }

    // startingReading is a one-time baseline (see the schema comment on
    // Nozzle.startingReading) — once this nozzle has any shift history, the
    // carry-forward rule has already taken over, and changing it here would
    // silently rewrite that baseline out from under readings that already
    // happened.
    if (dto.startingReading !== undefined) {
      const anyReading = await this.prisma.meterReading.findFirst({
        where: { nozzleId: id },
      });
      if (anyReading) {
        throw new ConflictException(
          `Nozzle ${id} already has shift history — startingReading can no longer be changed.`,
        );
      }
    }

    // A disabled nozzle drops out of findAll()'s default (active-only)
    // result, which is exactly what feeds the DSM app's/web portal's shift
    // picker. Disabling one mid-shift would strand whoever has it open —
    // they'd lose the ability to find it in the picker to close it out (the
    // web portal's meter-readings table can still close it directly since
    // that doesn't depend on the nozzle being active, but the DSM app's flow
    // does). Block it outright instead.
    if (dto.isActive === false) {
      const openShift = await this.prisma.meterReading.findFirst({
        where: { nozzleId: id, closingReading: null },
      });
      if (openShift) {
        throw new ConflictException(
          `Nozzle ${id} has an open shift (meterReadingId: ${openShift.id}) — close it before disabling this nozzle.`,
        );
      }
    }

    try {
      const updated = await this.prisma.nozzle.update({
        where: { id },
        data: {
          ...(dto.label !== undefined && { label: dto.label.trim() }),
          ...(dto.itemId !== undefined && { itemId: dto.itemId }),
          ...(dto.startingReading !== undefined && { startingReading: dto.startingReading }),
          ...(dto.rolloverAt !== undefined && { rolloverAt: dto.rolloverAt }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
        include: { item: true },
      });
      return this.withNextOpeningReading(updated);
    } catch (error) {
      this.handlePrismaError(error, dto.label ?? existing.label);
    }
  }

  // The reading this nozzle's NEXT shift will open with, per the carry-
  // forward rule: the most recently closed shift's closingReading, or
  // Nozzle.startingReading if this nozzle has never had a shift. Mirrors
  // MeterReadingsService.openShift()'s own resolveOpeningReading() exactly —
  // kept as a separate read-only preview here (not shared code) because this
  // one is fine to compute even while a shift is currently open on this
  // nozzle (it's just a display value), whereas openShift() itself blocks
  // outright on an open shift before it would ever reach this calculation.
  private async withNextOpeningReading<T extends Nozzle>(nozzle: T) {
    const lastClosed = await this.prisma.meterReading.findFirst({
      where: { nozzleId: nozzle.id, closingReading: { not: null } },
      orderBy: { shiftEnd: 'desc' },
    });
    return {
      ...nozzle,
      nextOpeningReading: lastClosed?.closingReading ?? nozzle.startingReading,
    };
  }

  private handlePrismaError(error: unknown, label: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new BadRequestException(
          `A nozzle labeled "${label}" already exists for this pump — labels must be unique per pump.`,
        );
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('itemId does not reference an existing Item record');
      }
    }
    throw error;
  }
}
