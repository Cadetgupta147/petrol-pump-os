import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { UpsertTaxRateConfigDto } from './dto/upsert-tax-rate-config.dto';

// Section 17.22 — dealer/accountant-configurable GST rate per product,
// replacing the "no tax field at all" gap in sales-purchase-register.service.ts
// with real, dealer-entered rates instead of an engineer inventing a tax
// percentage or a fuel/non-fuel split. Same manual find-then-create/update
// shape as DensityRangeConfigService.upsert() — see that file's comment for
// why this doesn't drive Prisma's native upsert() against the compound
// @@unique([pumpId, productType]) key.
@Injectable()
export class TaxRateConfigService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.taxRateConfig.findMany({
      orderBy: { productType: 'asc' },
    });
  }

  // Exposed for other services (sales-purchase-register.service.ts) that
  // need the whole map rather than the list — same shape as
  // resolveDensityRangeMap() in density-logs.service.ts. A productType with
  // no row here is simply absent from the map (treated as untaxed by the
  // caller), not defaulted to some guessed rate.
  async resolveTaxRateMap(): Promise<Record<string, number>> {
    const rows = await this.prisma.taxRateConfig.findMany();
    return Object.fromEntries(rows.map((row) => [row.productType, row.taxRatePercent]));
  }

  async upsert(dto: UpsertTaxRateConfigDto) {
    const existing = await this.prisma.taxRateConfig.findFirst({
      where: { productType: dto.productType },
    });

    if (existing) {
      return this.prisma.taxRateConfig.update({
        where: { id: existing.id },
        data: { taxRatePercent: dto.taxRatePercent },
      });
    }

    try {
      return await this.prisma.taxRateConfig.create({
        data: {
          pumpId: requireTenantContext().pumpId,
          productType: dto.productType,
          taxRatePercent: dto.taxRatePercent,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `A tax rate for productType "${dto.productType}" was just created by another request — retry the update`,
        );
      }
      throw error;
    }
  }
}
