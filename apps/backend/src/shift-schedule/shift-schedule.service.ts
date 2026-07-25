import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { CreateShiftDefinitionDto } from './dto/create-shift-definition.dto';
import { UpdateShiftDefinitionDto } from './dto/update-shift-definition.dto';
import { resolveCurrentShiftWindow } from './resolve-current-shift-window';

// Meter Reading redesign (Section 3.3) — the Owner-configurable shift
// schedule: a flat, dealer-managed list of named time-of-day windows (like
// Nozzle/Item Master), NOT a singleton config. One pump-wide schedule; all
// DSMs rotate through it together.
//
// Auth: enforced at the controller level — create/update are Owner/
// Accountant only (matching NozzlesController's access, not the wider Item
// Master access), reads additionally allow DSM (the batch-close screen's
// current-shift-label header).
@Injectable()
export class ShiftScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateShiftDefinitionDto) {
    try {
      return await this.prisma.shiftDefinition.create({
        data: {
          pumpId: requireTenantContext().pumpId,
          label: dto.label.trim(),
          startTime: dto.startTime,
          endTime: dto.endTime,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, dto.label);
    }
  }

  // includeInactive is false by default — real callers (the batch-close
  // label resolver, the DSM app's header) only care about currently-active
  // shifts. The Settings screen passes true so a disabled shift can still be
  // found and re-enabled, same reasoning as NozzlesService.findAll().
  findAll(includeInactive = false) {
    return this.prisma.shiftDefinition.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { startTime: 'asc' },
    });
  }

  async update(id: string, dto: UpdateShiftDefinitionDto) {
    const existing = await this.prisma.shiftDefinition.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`ShiftDefinition ${id} not found`);
    }
    try {
      return await this.prisma.shiftDefinition.update({
        where: { id },
        data: {
          ...(dto.label !== undefined && { label: dto.label.trim() }),
          ...(dto.startTime !== undefined && { startTime: dto.startTime }),
          ...(dto.endTime !== undefined && { endTime: dto.endTime }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    } catch (error) {
      this.handlePrismaError(error, dto.label ?? existing.label);
    }
  }

  // GET /shift-schedule/current — resolved purely for display (e.g. the DSM
  // app's batch-close screen header). NEVER used to validate or block a
  // batch-close submission — see resolve-current-shift-window.ts's own
  // comment for why exact shift-boundary precision doesn't matter here.
  async findCurrent(now: Date = new Date()) {
    const active = await this.findAll(false);
    return resolveCurrentShiftWindow(active, now);
  }

  private handlePrismaError(error: unknown, label: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new BadRequestException(
        `A shift labeled "${label}" already exists for this pump — labels must be unique per pump.`,
      );
    }
    throw error;
  }
}
