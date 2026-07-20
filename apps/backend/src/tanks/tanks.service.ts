import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTankDto } from './dto/create-tank.dto';
import { UpdateTankDto } from './dto/update-tank.dto';
import { CreateDipReadingDto } from './dto/create-dip-reading.dto';

// Section 7.1/7.2 — Tank CRUD (minimal, necessary-but-not-explicitly-asked-for
// per the task spec: PurchaseEntry and DipReading both need real Tank rows to
// reference, and nothing else in this codebase creates one) + DIP reading
// recording + the variance report.
//
// Auth: enforced at the controller level (global JwtAuthGuard + RolesGuard,
// see tanks.controller.ts) — Owner/Accountant only for Tank writes/reads,
// plus DSM for DIP reading creation.
//
// Section 7.2 doesn't specify a tolerance number for the variance flag, same
// situation as meter-readings.service.ts's VARIANCE_TOLERANCE_LITRES (that
// file's comment is the template for this one). This is a placeholder
// constant — a dealer-configurable tolerance would be a natural follow-up,
// out of scope here.
export const DIP_VARIANCE_TOLERANCE_LITRES = 5;

@Injectable()
export class TanksService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateTankDto) {
    return this.prisma.tank.create({
      data: {
        productType: dto.productType,
        capacityLitres: dto.capacityLitres,
        currentStockLitres: dto.currentStockLitres,
        calibrationChartRef: dto.calibrationChartRef ?? undefined,
      },
    });
  }

  findAll() {
    return this.prisma.tank.findMany({ orderBy: { productType: 'asc' } });
  }

  async findOne(id: string) {
    const tank = await this.prisma.tank.findUnique({ where: { id } });
    if (!tank) {
      throw new NotFoundException(`Tank ${id} not found`);
    }
    return tank;
  }

  async update(id: string, dto: UpdateTankDto) {
    // Confirm existence first so a bad id always yields a clean 404, not a
    // Prisma P2025 translated into a generic error (same pattern as
    // GiftCatalogService.update / CustomersService.update).
    await this.findOne(id);

    return this.prisma.tank.update({
      where: { id },
      data: {
        ...(dto.productType !== undefined && { productType: dto.productType }),
        ...(dto.capacityLitres !== undefined && {
          capacityLitres: dto.capacityLitres,
        }),
        ...(dto.currentStockLitres !== undefined && {
          currentStockLitres: dto.currentStockLitres,
        }),
        ...(dto.calibrationChartRef !== undefined && {
          calibrationChartRef: dto.calibrationChartRef,
        }),
      },
    });
  }

  // Section 7.2 step 3 — physical DIP stick reading vs. system-calculated
  // stock. systemStockAtReading is Tank.currentStockLitres captured
  // atomically (inside the same transaction as the write) at the moment of
  // this reading — it is NOT the same value as `reading` (the physical stick
  // measurement). variance = systemStockAtReading - reading; a positive
  // variance means the system thinks there's MORE fuel than the stick found
  // (shortage), negative means the stick found more than expected (excess).
  //
  // Also updates Tank.lastDipReading/lastDipAt (existing schema fields,
  // already surfaced read-only by DashboardService.getTankStock()) so that
  // KPI reflects the latest DIP, not a permanently-null placeholder.
  async recordDipReading(tankId: string, dto: CreateDipReadingDto) {
    await this.findOne(tankId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const tank = await tx.tank.findUniqueOrThrow({
          where: { id: tankId },
        });

        const systemStockAtReading = tank.currentStockLitres;
        const variance = systemStockAtReading - dto.reading;
        const flagged = Math.abs(variance) > DIP_VARIANCE_TOLERANCE_LITRES;

        const created = await tx.dipReading.create({
          data: {
            tankId,
            recordedById: dto.staffId,
            reading: dto.reading,
            systemStockAtReading,
            variance,
            flagged,
          },
        });

        await tx.tank.update({
          where: { id: tankId },
          data: {
            lastDipReading: dto.reading,
            lastDipAt: created.createdAt,
          },
        });

        return created;
      });
    } catch (error) {
      this.handlePrismaError(error, dto.staffId);
    }
  }

  // GET /tanks/:id/dip-readings — history, most recent first.
  async listDipReadings(tankId: string) {
    await this.findOne(tankId);
    return this.prisma.dipReading.findMany({
      where: { tankId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // GET /tanks/variance-report — Section 7.2 step 3's "variance report that
  // flags shortage/excess", one row per tank showing its LATEST DIP reading's
  // variance + flagged state. Deliberately does NOT re-aggregate
  // purchased/sold totals from PurchaseEntry/MeterReading history — the
  // human-supplied formula ("purchased - sold - physical DIP = variance") is
  // exactly what systemStockAtReading - reading already computes, since
  // Tank.currentStockLitres is itself continuously maintained as running
  // purchases-in minus sales-out (see purchases.service.ts and
  // meter-readings.service.ts closeShift()). Re-deriving it a second way from
  // raw history would duplicate state that's already tracked incrementally
  // and risks drifting from it.
  //
  // Tanks with no DIP reading yet are included with latestDipReading: null so
  // "which tanks need attention" also surfaces "which tanks have never been
  // dipped" — arguably itself an attention-worthy state for an audit-focused
  // report.
  async varianceReport() {
    const tanks = await this.prisma.tank.findMany({
      orderBy: { productType: 'asc' },
      include: {
        dipReadings: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return tanks.map((tank) => {
      const latest = tank.dipReadings[0] ?? null;
      return {
        tankId: tank.id,
        productType: tank.productType,
        currentStockLitres: tank.currentStockLitres,
        latestDipReading: latest
          ? {
              id: latest.id,
              reading: latest.reading,
              systemStockAtReading: latest.systemStockAtReading,
              variance: latest.variance,
              flagged: latest.flagged,
              recordedAt: latest.createdAt,
            }
          : null,
        toleranceLitres: DIP_VARIANCE_TOLERANCE_LITRES,
      };
    });
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
