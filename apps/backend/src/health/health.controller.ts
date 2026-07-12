import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

// Phase 0 scaffolding — simple liveness + DB connectivity check.
// Deliberately left unauthenticated (@Public()) — needed for uptime
// monitoring, which won't have a JWT. No business logic here.
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
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
