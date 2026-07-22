import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, lastValueFrom } from 'rxjs';
import { runInTenantContext, TenantContext } from './tenant-context';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { AuthenticatedCustomer } from '../customer-auth/types/customer-jwt-payload.interface';

type RequestUser = AuthenticatedUser | AuthenticatedCustomer;

// Phase 2 (docs/multi-tenancy-plan.md) — populates the AsyncLocalStorage
// tenant context for the duration of a request, from whichever JWT strategy
// (staff or customer) already authenticated it. Registered as a global
// APP_INTERCEPTOR in app.module.ts.
//
// Ordering: NestJS always runs Guards before Interceptors regardless of
// provider registration order, so req.user is guaranteed populated by
// JwtAuthGuard/CustomerJwtAuthGuard (if this route required auth at all) by
// the time this runs.
//
// A route with no authenticated user (public, or the UPI webhook route —
// see upi-webhook.controller.ts, which sets its own context explicitly from
// the pumpId path param since it has no JWT at all) simply runs with no
// tenant context — tenant-scoping.extension.ts treats that as "don't scope
// this query," which is correct for login/signup-style endpoints that must
// legitimately search across all pumps before a tenant is even known.
//
// Uses runInTenantContext (see tenant-context.ts) rather than calling
// tenantContextStorage.run() directly — that helper's own comment explains
// why: the callback given to .run() must be an async function that
// internally awaits, or the context silently fails to reach Prisma's query
// dispatch. next.handle() returns an Observable, not a Promise, so it's
// converted via lastValueFrom() to something that CAN be awaited inside
// that required async callback, then re-emitted to the real subscriber.
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;

    if (!user || !user.pumpId) {
      return next.handle();
    }

    const tenantContext: TenantContext = 'staffId' in user
      ? { pumpId: user.pumpId, staffId: user.staffId, role: user.role }
      : { pumpId: user.pumpId, customerId: user.customerId };

    return new Observable((subscriber) => {
      runInTenantContext(tenantContext, () => lastValueFrom(next.handle(), { defaultValue: undefined }))
        .then((result) => {
          subscriber.next(result);
          subscriber.complete();
        })
        .catch((error: unknown) => {
          subscriber.error(error);
        });
    });
  }
}
