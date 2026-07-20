import {
  Controller,
  HttpCode,
  Headers,
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
// one) — this route's "auth" is the HMAC signature check inside the service,
// not JwtAuthGuard. This is the intended, narrow use of @Public(); every
// other route in the app still requires a JWT (see app.module.ts).
//
// No DTO/@Body() here on purpose: the exact payload shape depends on
// whichever provider (PhonePe vs Paytm Business) is eventually chosen (see
// CLAUDE.md/Section 17 — still open), and the global ValidationPipe's
// `forbidNonWhitelisted: true` would reject fields we haven't modeled yet.
// req.body is read directly instead; req.rawBody (Buffer) is what the
// signature is actually verified against — see main.ts's `rawBody: true`
// and UpiWebhookService.handleWebhook().
@Public()
@Controller('upi-webhook')
export class UpiWebhookController {
  constructor(private readonly upiWebhookService: UpiWebhookService) {}

  @Post()
  @HttpCode(200)
  handle(
    @Req() req: RawBodyRequest<Request>,
    // Header name is a placeholder — see verify-webhook-signature.util.ts's
    // top comment for why this will need adjusting once a provider is
    // chosen.
    @Headers('x-webhook-signature') signature?: string,
  ) {
    return this.upiWebhookService.handleWebhook(
      req.rawBody,
      signature,
      req.body,
    );
  }
}
