import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

// Item Master — the single place an Owner/Manager/Accountant registers
// everything this pump sells. Nozzle.itemId references this directly
// (Section 3.3.1); Tank/PurchaseEntry/RateHistory/Bill still store a plain
// productType string, but their web portal forms read GET /items to
// populate that field's dropdown — see prisma/schema.prisma's Item comment
// for the full reasoning.
@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateItemDto) {
    try {
      return await this.prisma.item.create({
        data: {
          pumpId: requireTenantContext().pumpId,
          name: dto.name.trim(),
          category: dto.category,
          unit: dto.unit,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, dto.name);
    }
  }

  // includeInactive is false by default (findAll() feeds every dropdown
  // that shouldn't offer a disabled item — e.g. Nozzle setup's item
  // picker); the Item Settings screen passes true so a disabled item can
  // still be found and re-enabled (same reasoning as
  // NozzlesService.findAll()'s includeInactive param — see that comment).
  findAll(includeInactive = false) {
    return this.prisma.item.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.item.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`Item ${id} not found`);
    }
    return item;
  }

  async update(id: string, dto: UpdateItemDto) {
    await this.findOne(id);

    try {
      return await this.prisma.item.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.unit !== undefined && { unit: dto.unit }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    } catch (error) {
      this.handlePrismaError(error, dto.name);
    }
  }

  private handlePrismaError(error: unknown, name: string | undefined): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new BadRequestException(
          `An item named "${name}" already exists for this pump — names must be unique per pump.`,
        );
      }
    }
    throw error;
  }
}
