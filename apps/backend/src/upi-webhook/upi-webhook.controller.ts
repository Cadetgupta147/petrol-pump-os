import {
  Controller,
  HttpCode,
  Headers,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { UpiWebhookService } from './upi-webhook.service';

// Section 8A.3 — PhonePe/Paytm Business merchant webhook receiver.
//
// @Public(): PhonePe/Paytm will never send our staff JWT (they don't have
// one) — this route's "auth" is the per-pump signature check inside the
// service (UpiCaptureConfigService.findByPumpId() + verify*Signature()),
// not JwtAuthGuard. This is the intended, narrow use of @Public(); every
// other route in the app still requires a JWT (see app.module.ts).
//
// Multi-tenancy Phase 3 (docs/multi-tenancy-plan.md): this route has no JWT,
// so TenantContextInterceptor never runs for it — there is no req.user to
// derive a pumpId from. Instead pumpId travels in the URL path itself
// (each pump's merchant dashboard is configured with its own webhook URL,
// e.g. https://.../upi-webhook/<pumpId>), and the service sets the
// AsyncLocalStorage tenant context explicitly from that path param before
// touching any tenant-scoped table.
//
// No DTO/@Body() here on purpose: the exact payload shape depends on
// whichever provider sent it (PhonePe vs Paytm Business have different
// bodies — see upi-webhook.service.ts's RawUpiWebhookPayload comment), and
// the global ValidationPipe's `forbidNonWhitelisted: true` would reject
// fields we haven't modeled yet. req.body is read directly instead.
//
// The `authorization` header carries PhonePe's signature (Authorization:
// SHA256(username:password) — see verify-webhook-signature.util.ts); Paytm
// instead sends its checksum as a CHECKSUMHASH field inside the body, so it
// doesn't need a header at all. Both are threaded through unconditionally;
// UpiWebhookService picks whichever one it actually needs based on this
// pump's configured provider.
@Public()
@Controller('upi-webhook')
export class UpiWebhookController {
  constructor(private readonly upiWebhookService: UpiWebhookService) {}

  @Post(':pumpId')
  @HttpCode(200)
  handle(
    @Param('pumpId') pumpId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') authorizationHeader?: string,
  ) {
    return this.upiWebhookService.handleWebhook(
      pumpId,
      req.rawBody,
      authorizationHeader,
      req.body,
    );
  }
}
