import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMachineTestingLogDto } from './dto/create-machine-testing-log.dto';

// Dashboard "Not wired to a backend endpoint yet" panel item #5 — "Machine
// testing/calibration". Standalone audit-trail + tank-stock-effect entity —
// deliberately does NOT touch MeterReading or its opening/closing/variance
// formula (docs/master-plan.md Section 3.3.1 explicitly defers folding a
// "Testing" adjustment column into that formula as a separate, not-yet-
// decided vertical slice; that stays deferred here too).
@Injectable()
export class MachineTestingService {
  constructor(private readonly prisma: PrismaService) {}

  // performedById is a plain method arg, never read off the DTO — see
  // MachineTestingController, same actor-derivation rule as
  // PurchasesService.create().
  async create(dto: CreateMachineTestingLogDto, performedById: string) {
    const tank = await this.prisma.tank.findUnique({
      where: { id: dto.tankId },
    });
    if (!tank) {
      throw new NotFoundException(`Tank ${dto.tankId} not found`);
    }

    const litresDrawnOff = dto.litresDrawnOff ?? 0;
    const createData = {
      pumpId: tank.pumpId,
      tankId: tank.id,
      litresDrawnOff,
      result: dto.result,
      deviationFound: dto.deviationFound,
      calibrationChartRef: dto.calibrationChartRef,
      performedById,
      notes: dto.notes,
    };

    // Most calibration checks draw off no fuel at all — only open a
    // transaction (and touch Tank stock) when litresDrawnOff is actually
    // positive, same reasoning as PurchasesService's conditional DensityLog
    // operation.
    if (litresDrawnOff > 0) {
      const [log] = await this.prisma.$transaction([
        this.prisma.machineTestingLog.create({ data: createData }),
        this.prisma.tank.update({
          where: { id: tank.id },
          data: { currentStockLitres: { decrement: litresDrawnOff } },
        }),
      ]);
      return log;
    }

    return this.prisma.machineTestingLog.create({ data: createData });
  }

  findAll() {
    return this.prisma.machineTestingLog.findMany({
      orderBy: { performedAt: 'desc' },
    });
  }
}
