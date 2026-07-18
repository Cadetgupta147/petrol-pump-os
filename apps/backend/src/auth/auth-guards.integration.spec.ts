import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { AuthModule } from './auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';

// Integration coverage for the global guard wiring (JwtAuthGuard + RolesGuard
// registered as APP_GUARD in app.module.ts). Exercises real HTTP requests
// against a temporary controller (per task spec: "you can use a
// temporary/mock route ... your call on what's cleanest given no Owner-only
// route exists yet in real code") rather than every real controller, since
// the guard behavior is identical everywhere it's applied.
@Controller('test-guarded')
class TestGuardedController {
  @Public()
  @Get('public')
  publicRoute() {
    return { ok: true };
  }

  @Get('protected')
  protectedRoute() {
    return { ok: true };
  }

  // Stand-in for a future real Owner-only route (e.g. loyalty-config,
  // business-settings — see roles.decorator.ts header comment).
  @Roles(Role.OWNER)
  @Get('owner-only')
  ownerOnlyRoute() {
    return { ok: true };
  }
}

describe('Global auth guards (JwtAuthGuard + RolesGuard) — integration', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? 'test-secret-for-auth-guards-integration-spec';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, PrismaModule],
      controllers: [TestGuardedController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      // AuthModule's AuthService depends on PrismaService; not exercised by
      // this test (no /auth/login calls here), so a stub is enough — avoids
      // needing a real DB connection just to test guard wiring.
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const httpServer = app.getHttpServer() as Server;
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    jwtService = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows a @Public() route through with no token', async () => {
    const res = await fetch(`${baseUrl}/test-guarded/public`);
    expect(res.status).toBe(200);
  });

  it('rejects a protected route with no token (401)', async () => {
    const res = await fetch(`${baseUrl}/test-guarded/protected`);
    expect(res.status).toBe(401);
  });

  it('rejects a protected route with a malformed/invalid token (401)', async () => {
    const res = await fetch(`${baseUrl}/test-guarded/protected`, {
      headers: { Authorization: 'Bearer not-a-real-jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('allows a protected route through with a valid token', async () => {
    const token = await jwtService.signAsync({
      staffId: 'staff-1',
      role: Role.ACCOUNTANT,
      sub: 'staff-1',
    });

    const res = await fetch(`${baseUrl}/test-guarded/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('blocks a non-OWNER role from an @Roles(Role.OWNER)-only route (403)', async () => {
    const token = await jwtService.signAsync({
      staffId: 'staff-2',
      role: Role.ACCOUNTANT,
      sub: 'staff-2',
    });

    const res = await fetch(`${baseUrl}/test-guarded/owner-only`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('allows OWNER through the @Roles(Role.OWNER)-only route', async () => {
    const token = await jwtService.signAsync({
      staffId: 'staff-3',
      role: Role.OWNER,
      sub: 'staff-3',
    });

    const res = await fetch(`${baseUrl}/test-guarded/owner-only`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
