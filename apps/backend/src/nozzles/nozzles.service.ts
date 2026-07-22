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
          productType: dto.productType.trim(),
          startingReading: dto.startingReading,
        },
      });
      return this.withNextOpeningReading(created);
    } catch (error) {
      this.handlePrismaError(error, dto.label);
    }
  }

  // Every active nozzle for this pump, each carrying the reading its NEXT
  // shift will open with (see withNextOpeningReading()) — this is exactly
  // what populates the DSM app's/web portal's nozzle dropdown, so a DSM never
  // types a nozzle id or an opening reading, only picks from this list.
  async findAll() {
    const nozzles = await this.prisma.nozzle.findMany({
      where: { isActive: true },
      orderBy: { label: 'asc' },
    });
    return Promise.all(nozzles.map((nozzle) => this.withNextOpeningReading(nozzle)));
  }

  async findOne(id: string) {
    const nozzle = await this.prisma.nozzle.findUnique({ where: { id } });
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

    try {
      const updated = await this.prisma.nozzle.update({
        where: { id },
        data: {
          ...(dto.label !== undefined && { label: dto.label.trim() }),
          ...(dto.productType !== undefined && { productType: dto.productType.trim() }),
          ...(dto.startingReading !== undefined && { startingReading: dto.startingReading }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
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
  private async withNextOpeningReading(nozzle: Nozzle) {
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
    }
    throw error;
  }
}
