import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantScopingExtension } from './tenant-scoping.extension';

// PrismaService wraps PrismaClient generated from the root prisma/schema.prisma
// (single source of truth per CLAUDE.md — do not duplicate the schema here).
//
// Phase 2 (docs/multi-tenancy-plan.md) — every tenant-scoped model's queries
// are automatically filtered/stamped by pumpId via tenantScopingExtension.
// $extends() returns a NEW client object (Prisma's Client Extension API,
// not the classic $use middleware, which was fully removed as of Prisma 5)
// — it is NOT an instance of this PrismaService class. To keep every one of
// this codebase's ~26 services injecting/using `PrismaService` completely
// unchanged, the constructor explicitly `return`s that extended object
// instead of `this` (a real, if unusual, JS pattern: a class constructor
// that returns an object uses that object as the constructed instance,
// including for `new PrismaService()` calls made by Nest's DI container).
// The two lifecycle methods are manually re-attached (bound to the
// original, unextended `this`) onto the returned object so Nest's
// lifecycle system still finds and calls them — $connect/$disconnect
// operate on the underlying engine/connection either way, so calling them
// via the unextended instance is functionally identical to calling them via
// the extended one.
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
    const extended = this.$extends(tenantScopingExtension());
    return Object.assign(extended, {
      onModuleInit: this.onModuleInit.bind(this),
      onModuleDestroy: this.onModuleDestroy.bind(this),
    }) as unknown as PrismaService;
  }

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (error) {
      // Don't crash the whole app on boot if the DB isn't reachable yet —
      // callers (e.g. the health check) should surface connectivity issues
      // explicitly rather than the server failing to start.
      this.logger.error('Failed to connect to the database on startup', error as Error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
