import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Guards customer-only routes. Unlike the staff JwtAuthGuard (registered
// globally as APP_GUARD in app.module.ts, covering every route by default),
// this guard is applied explicitly per-controller/route via
// `@UseGuards(CustomerJwtAuthGuard)` — there's no global customer guard,
// since most of the app (web portal + DSM app) is staff-only.
//
// IMPORTANT for future customer-scoped endpoints (bill history, points
// balance, gift catalog, etc. — Section 5/6): they must be decorated with
// BOTH @Public() (to opt out of the global staff JwtAuthGuard, which would
// otherwise 401 a customer token before this guard ever runs — see
// auth/decorators/public.decorator.ts) AND
// @UseGuards(CustomerJwtAuthGuard) (to require a valid customer token).
// Forgetting @Public() makes the route unreachable by customers; forgetting
// @UseGuards(CustomerJwtAuthGuard) makes it reachable by anyone.
@Injectable()
export class CustomerJwtAuthGuard extends AuthGuard('customer-jwt') {}
