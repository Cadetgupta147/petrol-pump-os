import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ItemCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateItemSaleDto } from './dto/create-item-sale.dto';

// Dashboard "Not wired to a backend endpoint yet" panel items #1/#2 —
// "Lubricant sale" and "Urea/DEF sale". One shared endpoint: both are a
// non-fuel Item Master sale, differing only in whether a linked
// LubricantItem stock row exists to decrement (category LUBRICANT) or not
// (category OTHER — e.g. Urea/AdBlue, which has no dedicated stock model at
// all per docs/master-plan.md, and was never given one in the spec).
// FUEL-category items are rejected — those sales go through the existing
// meter reading/billing flow, not this one.
@Injectable()
export class ItemSalesService {
  constructor(private readonly prisma: PrismaService) {}

  // soldById is a plain method arg, never read off the DTO — see
  // ItemSalesController, same actor-derivation rule as PurchasesService.create().
  async create(dto: CreateItemSaleDto, soldById: string) {
    const item = await this.prisma.item.findUnique({ where: { id: dto.itemId } });
    if (!item) {
      throw new NotFoundException(`Item ${dto.itemId} not found`);
    }
    if (item.category === ItemCategory.FUEL) {
      throw new BadRequestException(
        `Item "${item.name}" is a FUEL item — fuel sales go through meter reading/billing, not this endpoint`,
      );
    }

    // Computed server-side, not trusted from the client — see the DTO's
    // comment for why this differs from PurchaseEntry's independent
    // amount/rate fields.
    const amount = dto.quantity * dto.unitPrice;
    const saleData = {
      pumpId: item.pumpId,
      itemId: dto.itemId,
      quantity: dto.quantity,
      unitPrice: dto.unitPrice,
      amount,
      paymentType: dto.paymentType,
      soldById,
    };

    if (item.category !== ItemCategory.LUBRICANT) {
      // OTHER (e.g. Urea/AdBlue) — no stock model exists for this category,
      // so this is a plain revenue-recording create with no stock effect.
      return this.prisma.itemSale.create({ data: saleData });
    }

    const lubricantItem = await this.prisma.lubricantItem.findUnique({
      where: { itemId: dto.itemId },
    });
    if (!lubricantItem) {
      throw new NotFoundException(
        `Item "${item.name}" has no lubricant stock/pricing configured yet — add it via POST /lubricant-items first`,
      );
    }
    if (lubricantItem.stockQty < dto.quantity) {
      throw new ConflictException(
        `Insufficient stock for "${item.name}": ${lubricantItem.stockQty} in stock, ${dto.quantity} requested`,
      );
    }

    const [sale] = await this.prisma.$transaction([
      this.prisma.itemSale.create({ data: saleData }),
      this.prisma.lubricantItem.update({
        where: { id: lubricantItem.id },
        data: { stockQty: { decrement: dto.quantity } },
      }),
    ]);
    return sale;
  }

  findAll() {
    return this.prisma.itemSale.findMany({
      include: { item: true },
      orderBy: { soldAt: 'desc' },
    });
  }
}
