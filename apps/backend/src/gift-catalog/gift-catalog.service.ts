import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { CreateGiftCatalogItemDto } from './dto/create-gift-catalog-item.dto';
import { UpdateGiftCatalogItemDto } from './dto/update-gift-catalog-item.dto';

// Section 6.4 Lever 2 — gift catalog CRUD. Auth/role guards do exist and
// apply here: the global JwtAuthGuard (app.module.ts) requires a valid JWT
// on every route, and GiftCatalogController carries @Roles(Role.OWNER) as
// its class-level default for writes, enforced by the global RolesGuard.
@Injectable()
export class GiftCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateGiftCatalogItemDto) {
    return this.prisma.giftCatalogItem.create({
      data: {
        pumpId: requireTenantContext().pumpId,
        giftName: dto.giftName,
        imageUrl: dto.imageUrl ?? undefined,
        pointsRequired: dto.pointsRequired,
        stockQuantity: dto.stockQuantity ?? undefined,
        activeFlag: dto.activeFlag ?? true,
      },
    });
  }

  findAll() {
    return this.prisma.giftCatalogItem.findMany({
      orderBy: { giftName: 'asc' },
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.giftCatalogItem.findUnique({
      where: { id },
    });
    if (!item) {
      throw new NotFoundException(`Gift catalog item ${id} not found`);
    }
    return item;
  }

  async update(id: string, dto: UpdateGiftCatalogItemDto) {
    // Confirm existence first so a bad id always yields a clean 404, not a
    // Prisma P2025 translated into a generic error (same pattern as
    // CustomersService.update).
    await this.findOne(id);

    return this.prisma.giftCatalogItem.update({
      where: { id },
      data: {
        ...(dto.giftName !== undefined && { giftName: dto.giftName }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.pointsRequired !== undefined && {
          pointsRequired: dto.pointsRequired,
        }),
        ...(dto.stockQuantity !== undefined && {
          stockQuantity: dto.stockQuantity,
        }),
        ...(dto.activeFlag !== undefined && { activeFlag: dto.activeFlag }),
      },
    });
  }

  // Section 6.4: "Dealer can retire a gift without deleting its redemption
  // history." GiftCatalogItem is FK-referenced by RedemptionTransaction
  // (schema.prisma), so this deliberately never issues a hard delete —
  // DELETE /gift-catalog/:id soft-retires by flipping activeFlag to false,
  // same row/id, same redemption history, and RedemptionsService rejects new
  // redemptions of a retired gift going forward.
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.giftCatalogItem.update({
      where: { id },
      data: { activeFlag: false },
    });
  }

  // Section 12 — Gift Redemption Report ("which gifts are redeemed most,
  // current gift stock levels"). Returns EVERY catalog item (including ones
  // never redeemed and retired ones), each annotated with its redemption
  // stats — a report that only listed ever-redeemed gifts couldn't answer
  // "which gifts have zero redemptions" or show current stock for
  // never-touched items, both of which are exactly what "current stock
  // levels" implies reading this report for.
  async getRedemptionReport() {
    const [items, redemptionGroups] = await Promise.all([
      this.prisma.giftCatalogItem.findMany({ orderBy: { giftName: 'asc' } }),
      this.prisma.redemptionTransaction.groupBy({
        by: ['giftItemId'],
        where: { redemptionType: 'GIFT', giftItemId: { not: null } },
        _count: { _all: true },
        _sum: { pointsSpent: true },
      }),
    ]);

    const statsByGiftId = new Map(
      redemptionGroups
        .filter((group) => group.giftItemId !== null)
        .map((group) => [group.giftItemId as string, group]),
    );

    const rows = items.map((item) => {
      const stats = statsByGiftId.get(item.id);
      return {
        giftItemId: item.id,
        giftName: item.giftName,
        pointsRequired: item.pointsRequired,
        stockQuantity: item.stockQuantity,
        activeFlag: item.activeFlag,
        timesRedeemed: stats?._count._all ?? 0,
        totalPointsSpent: stats?._sum.pointsSpent ?? 0,
      };
    });

    // Most-redeemed first — this report exists to answer "which gifts are
    // popular" (Section 12's own wording), so that's the natural default
    // read order; ties keep the alphabetical order already applied above.
    return rows.sort((a, b) => b.timesRedeemed - a.timesRedeemed);
  }
}
