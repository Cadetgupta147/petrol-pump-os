import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { UpsertDensityRangeConfigDto } from './dto/upsert-density-range-config.dto';

// Section 17.19 — dealer/accountant-configurable acceptable density range per
// product, replacing the hardcoded placeholder in density-logs.service.ts
// (DEFAULT_DENSITY_RANGE_BY_PRODUCT) with real, pump-specific numbers an
// Owner enters (ideally sourced from their OMC's quoted acceptable range).
//
// Not a true global singleton like CreditConfig — one row per (pump,
// productType), so upsert() looks up by productType via findFirst() rather
// than Prisma's native upsert() against the compound @@unique([pumpId,
// productType]) key. This codebase has no existing precedent for driving a
// compound-unique upsert through the tenant-scoping Prisma Client Extension
// (see tenant-scoping.extension.ts's scopeArgs() — it spreads pumpId at the
// top level of `where`, which is correct for findUnique's "extended where
// unique input" but unverified for upsert's compound-key `where` shape), so
// this uses the same manual find-then-create/update pattern
// AttendanceService.clockIn() uses instead of risking an unverified
// interaction.
@Injectable()
export class DensityRangeConfigService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.densityRangeConfig.findMany({
      orderBy: { productType: 'asc' },
    });
  }

  async upsert(dto: UpsertDensityRangeConfigDto) {
    if (dto.minDensity >= dto.maxDensity) {
      throw new BadRequestException('minDensity must be less than maxDensity');
    }

    const existing = await this.prisma.densityRangeConfig.findFirst({
      where: { productType: dto.productType },
    });

    if (existing) {
      return this.prisma.densityRangeConfig.update({
        where: { id: existing.id },
        data: { minDensity: dto.minDensity, maxDensity: dto.maxDensity },
      });
    }

    try {
      return await this.prisma.densityRangeConfig.create({
        data: {
          pumpId: requireTenantContext().pumpId,
          productType: dto.productType,
          minDensity: dto.minDensity,
          maxDensity: dto.maxDensity,
        },
      });
    } catch (error) {
      // A genuine race — two concurrent requests both found no existing row
      // for this productType and both tried to create one — surfaces as the
      // DB's own @@unique([pumpId, productType]) constraint (P2002) rather
      // than the findFirst()-then-create() gap silently duplicating data.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `A density range for productType "${dto.productType}" was just created by another request — retry the update`,
        );
      }
      throw error;
    }
  }
}
