import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// PrismaService wraps PrismaClient generated from the root prisma/schema.prisma
// (single source of truth per CLAUDE.md — do not duplicate the schema here).
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

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
