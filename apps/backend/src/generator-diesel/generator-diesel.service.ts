import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGeneratorDieselLogDto } from './dto/create-generator-diesel-log.dto';

// Dashboard "Not wired to a backend endpoint yet" panel item #3 — "Generator
// diesel used". Diesel drawn off for a generator is a real Tank outflow that
// isn't a nozzle sale — recording it decrements Tank.currentStockLitres in
// the same transaction, so it doesn't get misread as pilferage/shortage by
// the Section 7.2 variance report.
//
// No floor-check on the decrement, matching the existing nozzle-sale
// decrement in MeterReadingsService.closeShift() — variance reporting is the
// intended catch here too, not a hard block.
@Injectable()
export class GeneratorDieselService {
  constructor(private readonly prisma: PrismaService) {}

  // recordedById is a plain method arg, never read off the DTO — see
  // GeneratorDieselController, same actor-derivation rule as
  // PurchasesService.create().
  async create(dto: CreateGeneratorDieselLogDto, recordedById: string) {
    const tank = await this.prisma.tank.findUnique({
      where: { id: dto.tankId },
    });
    if (!tank) {
      throw new NotFoundException(`Tank ${dto.tankId} not found`);
    }

    const [log] = await this.prisma.$transaction([
      this.prisma.generatorDieselLog.create({
        data: {
          pumpId: tank.pumpId,
          tankId: tank.id,
          quantityLitres: dto.quantityLitres,
          recordedById,
          notes: dto.notes,
        },
      }),
      this.prisma.tank.update({
        where: { id: tank.id },
        data: { currentStockLitres: { decrement: dto.quantityLitres } },
      }),
    ]);

    return log;
  }

  findAll() {
    return this.prisma.generatorDieselLog.findMany({
      orderBy: { recordedAt: 'desc' },
    });
  }
}
