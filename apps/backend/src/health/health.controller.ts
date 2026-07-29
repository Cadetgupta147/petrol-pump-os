import { Controller, Get, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

// Phase 0 scaffolding — simple liveness + DB connectivity check.
// Deliberately left unauthenticated (@Public()) — needed for uptime
// monitoring, which won't have a JWT. No business logic here.
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    const status = { status: 'ok', timestamp: new Date().toISOString() };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ...status, database: 'up' };
    } catch (error) {
      // Go-live checklist: this route is @Public() — reachable by anyone on
      // the internet, no JWT — so the real Prisma error (host, port,
      // connection-string detail) must never ride along in the response
      // body the way it used to. Log it server-side only, same rule as
      // GlobalExceptionFilter; the client just gets "down".
      this.logger.error('Health check DB connectivity probe failed', error as Error);
      return { ...status, database: 'down' };
    }
  }
}
