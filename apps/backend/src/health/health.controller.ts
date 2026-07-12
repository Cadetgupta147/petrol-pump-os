import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Phase 0 scaffolding — simple liveness + DB connectivity check.
// No auth, no business logic (see CLAUDE.md / docs/master-plan.md Section 15.1).
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const status = { status: 'ok', timestamp: new Date().toISOString() };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ...status, database: 'up' };
    } catch (error) {
      return {
        ...status,
        database: 'down',
        databaseError: (error as Error).message,
      };
    }
  }
}
