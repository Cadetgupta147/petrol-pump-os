import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function makeContext(user?: { staffId: string; role: Role }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows the request through when no @Roles() metadata is present', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(makeContext({ staffId: 's1', role: Role.ACCOUNTANT }))).toBe(true);
  });

  it('allows an OWNER through an @Roles(Role.OWNER)-only route', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.OWNER]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(makeContext({ staffId: 's1', role: Role.OWNER }))).toBe(true);
  });

  it('blocks a non-OWNER role (e.g. ACCOUNTANT) from an @Roles(Role.OWNER)-only route', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.OWNER]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(makeContext({ staffId: 's1', role: Role.ACCOUNTANT }))).toThrow(
      ForbiddenException,
    );
  });

  it('blocks a request with no authenticated user on a restricted route', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.OWNER]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
