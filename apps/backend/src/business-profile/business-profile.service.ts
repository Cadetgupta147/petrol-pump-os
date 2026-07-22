import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';

// TypeScript can't see that tenant-scoping.extension.ts injects `pumpId`
// into `where` at runtime (satisfying the `@@unique([pumpId])` constraint)
// — this cast documents that deliberately, rather than lying with `as any`.
const EMPTY_UNIQUE_WHERE = {} as Prisma.BusinessProfileWhereUniqueInput;

// Section 3.9 — business profile, GSTIN, pump license details.
//
// Singleton-PER-PUMP pattern: at most one row per pump. Phase 2
// (docs/multi-tenancy-plan.md) — see CreditConfigService's comment for the
// full story: this used to be pinned to a single hardcoded global id
// ('singleton'), which broke the moment a second pump existed. `id` is now
// a normal auto-generated cuid; `@@unique([pumpId])` is the real per-pump
// uniqueness guarantee, transparently enforced by tenant-scoping.extension.ts
// injecting `pumpId` into the (visually empty) where/create below.
//
// Auth/role guards do exist and apply here: the global JwtAuthGuard
// (app.module.ts) requires a valid JWT on every route, and
// BusinessProfileController carries @Roles(Role.OWNER) on the mutation
// route (PATCH) — see that controller's comment for why.
@Injectable()
export class BusinessProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate() {
    // Phase 0.3 (docs/multi-tenancy-plan.md) — pumpId is a required field
    // on BusinessProfileCreateInput now, so it must be stamped explicitly
    // here even though the extension's upsert handling would also inject
    // it at runtime (data.pumpId ?? ctx.pumpId — see
    // tenant-scoping.extension.ts's scopeArgs()).
    return this.prisma.businessProfile.upsert({
      where: EMPTY_UNIQUE_WHERE,
      create: { pumpId: requireTenantContext().pumpId },
      update: {},
    });
  }

  async update(dto: UpdateBusinessProfileDto) {
    return this.prisma.businessProfile.upsert({
      where: EMPTY_UNIQUE_WHERE,
      create: {
        pumpId: requireTenantContext().pumpId,
        ...(dto.businessName !== undefined && { businessName: dto.businessName }),
        ...(dto.gstin !== undefined && { gstin: dto.gstin }),
        ...(dto.pumpLicenseNo !== undefined && { pumpLicenseNo: dto.pumpLicenseNo }),
        ...(dto.address !== undefined && { address: dto.address }),
      },
      update: {
        ...(dto.businessName !== undefined && { businessName: dto.businessName }),
        ...(dto.gstin !== undefined && { gstin: dto.gstin }),
        ...(dto.pumpLicenseNo !== undefined && { pumpLicenseNo: dto.pumpLicenseNo }),
        ...(dto.address !== undefined && { address: dto.address }),
      },
    });
  }
}
