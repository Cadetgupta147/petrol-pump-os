import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireTenantContext } from '../common/tenant-context';
import { UpdateCreditConfigDto } from './dto/update-credit-config.dto';

// TypeScript can't see that tenant-scoping.extension.ts injects `pumpId`
// into `where` at runtime (satisfying the `@@unique([pumpId])` constraint)
// — this cast documents that deliberately, rather than lying with `as any`.
const EMPTY_UNIQUE_WHERE = {} as Prisma.CreditConfigWhereUniqueInput;

// Section 3.4A — dealer-configurable credit limit enforcement mode
// (NOTIFY default / BLOCK) and the default credit limit auto-applied to
// quick-added (informal) customers.
//
// Singleton-PER-POOL pattern: at most one row per pump. Phase 2
// (docs/multi-tenancy-plan.md) — this used to be pinned to a single
// hardcoded global id ('singleton'), atomic via Prisma's upsert(). That
// broke the moment a second pump existed (every pump's upsert tried to
// claim the SAME id, a P2002 unique-constraint collision against the first
// pump's row — caught live against the real dev DB, see the Phase 2
// progress log). Now `id` is a normal auto-generated cuid, and the
// per-pump uniqueness guarantee is `@@unique([pumpId])` — `where: {}` /
// `create: {}` below look empty because tenant-scoping.extension.ts
// (registered on PrismaService) transparently injects `pumpId` from the
// request's AsyncLocalStorage context into both, the same way it does for
// every other tenant-scoped model.
//
// Auth/role guards do exist and apply here: the global JwtAuthGuard
// (app.module.ts) requires a valid JWT on every route, and
// CreditConfigController carries @Roles(Role.OWNER), enforced by the
// global RolesGuard. No staff outside that role can reach this service via
// HTTP.
@Injectable()
export class CreditConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate() {
    // Phase 0.3 (docs/multi-tenancy-plan.md) — pumpId is a required field
    // on CreditConfigCreateInput now, so it must be stamped explicitly
    // here even though the extension's upsert handling would also inject
    // it at runtime.
    return this.prisma.creditConfig.upsert({
      where: EMPTY_UNIQUE_WHERE,
      create: { pumpId: requireTenantContext().pumpId },
      update: {},
    });
  }

  async update(dto: UpdateCreditConfigDto) {
    return this.prisma.creditConfig.upsert({
      where: EMPTY_UNIQUE_WHERE,
      create: {
        pumpId: requireTenantContext().pumpId,
        ...(dto.enforcementMode !== undefined && {
          enforcementMode: dto.enforcementMode,
        }),
        ...(dto.defaultInformalCreditLimit !== undefined && {
          defaultInformalCreditLimit: dto.defaultInformalCreditLimit,
        }),
      },
      update: {
        ...(dto.enforcementMode !== undefined && {
          enforcementMode: dto.enforcementMode,
        }),
        ...(dto.defaultInformalCreditLimit !== undefined && {
          defaultInformalCreditLimit: dto.defaultInformalCreditLimit,
        }),
      },
    });
  }
}
