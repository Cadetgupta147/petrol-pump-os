import { ExecutionContext, Injectable, CanActivate, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../types/jwt-payload.interface';

// Runs after JwtAuthGuard (registered globally alongside it — see
// app.module.ts) so req.user is already populated. Routes with no @Roles()
// metadata are allowed through for any authenticated staff member; routes
// decorated @Roles(Role.OWNER, ...) restrict to that list.
//
// See decorators/roles.decorator.ts for the current OWNER/ACCOUNTANT-only
// scope and the note about loyalty-config/business-settings needing
// @Roles(Role.OWNER) once those endpoints exist.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }

    return true;
  }
}
