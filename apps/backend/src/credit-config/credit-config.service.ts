import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCreditConfigDto } from './dto/update-credit-config.dto';

// Section 3.4A — dealer-configurable credit limit enforcement mode
// (NOTIFY default / BLOCK) and the default credit limit auto-applied to
// quick-added (informal) customers.
//
// Singleton pattern: only one row is ever really meant to matter. This is
// pinned to a fixed, known id (CREDIT_CONFIG_ID) and every read/write goes
// through Prisma's upsert() against that id, which is atomic at the DB
// level (id has a unique constraint via @id) — this guarantees at most one
// row can ever exist, with no race window between concurrent first-ever
// calls.
//
// Auth/role guards do exist and apply here: the global JwtAuthGuard
// (app.module.ts) requires a valid JWT on every route, and
// CreditConfigController carries @Roles(Role.OWNER), enforced by the
// global RolesGuard. No staff outside that role can reach this service via
// HTTP.
const CREDIT_CONFIG_ID = 'singleton';

@Injectable()
export class CreditConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate() {
    return this.prisma.creditConfig.upsert({
      where: { id: CREDIT_CONFIG_ID },
      create: { id: CREDIT_CONFIG_ID },
      update: {},
    });
  }

  async update(dto: UpdateCreditConfigDto) {
    return this.prisma.creditConfig.upsert({
      where: { id: CREDIT_CONFIG_ID },
      create: {
        id: CREDIT_CONFIG_ID,
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
