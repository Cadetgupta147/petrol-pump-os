import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ItemCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLubricantItemDto } from './dto/create-lubricant-item.dto';
import { UpdateLubricantItemDto } from './dto/update-lubricant-item.dto';

// Dashboard "Not wired to a backend endpoint yet" panel item #1 — "Lubricant
// sale" ("LubricantItem exists in the schema (stock only, no sale-price/SKU
// fields), but zero service or controller exists anywhere for it"). This
// service is the SKU/pricing/stock half of that gap; ItemSalesService is the
// sale-recording half.
@Injectable()
export class LubricantItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateLubricantItemDto) {
    const item = await this.prisma.item.findUnique({ where: { id: dto.itemId } });
    if (!item) {
      throw new NotFoundException(`Item ${dto.itemId} not found`);
    }
    if (item.category !== ItemCategory.LUBRICANT) {
      throw new BadRequestException(
        `Item "${item.name}" is category ${item.category}, not LUBRICANT — register it as a LUBRICANT item in Item Master first`,
      );
    }

    try {
      return await this.prisma.lubricantItem.create({
        data: {
          pumpId: item.pumpId,
          itemId: dto.itemId,
          sku: dto.sku,
          costPrice: dto.costPrice,
          salePrice: dto.salePrice,
          stockQty: dto.stockQty,
          reorderAt: dto.reorderAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException(
          `Item "${item.name}" already has a lubricant stock/pricing entry — use PATCH to update it instead`,
        );
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.lubricantItem.findMany({
      include: { item: true },
      orderBy: { item: { name: 'asc' } },
    });
  }

  async findOne(id: string) {
    const lubricantItem = await this.prisma.lubricantItem.findUnique({
      where: { id },
      include: { item: true },
    });
    if (!lubricantItem) {
      throw new NotFoundException(`Lubricant item ${id} not found`);
    }
    return lubricantItem;
  }

  async update(id: string, dto: UpdateLubricantItemDto) {
    await this.findOne(id);
    return this.prisma.lubricantItem.update({
      where: { id },
      data: {
        ...(dto.sku !== undefined && { sku: dto.sku }),
        ...(dto.costPrice !== undefined && { costPrice: dto.costPrice }),
        ...(dto.salePrice !== undefined && { salePrice: dto.salePrice }),
        ...(dto.stockQty !== undefined && { stockQty: dto.stockQty }),
        ...(dto.reorderAt !== undefined && { reorderAt: dto.reorderAt }),
      },
    });
  }
}
