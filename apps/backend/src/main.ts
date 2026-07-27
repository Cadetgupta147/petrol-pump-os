import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

// CORS allowlist is env-driven (CORS_ALLOWED_ORIGINS, comma-separated) so
// deployed frontend domains can be added later without a code change. In
// development, if the env var is unset, we default to Vite's default dev
// origin so `apps/web-portal` (not yet scaffolded) works out of the box.
function resolveAllowedOrigins(): string[] {
  const configured = process.env.CORS_ALLOWED_ORIGINS;
  if (configured && configured.trim().length > 0) {
    return configured
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }
  if (process.env.NODE_ENV !== 'production') {
    return ['http://localhost:5173'];
  }
  return [];
}

async function bootstrap() {
  // Section 8A.3 — the PhonePe/Paytm UPI webhook needs the exact raw request
  // bytes to verify the provider's signature (re-serialized JSON won't
  // byte-match what the provider signed). `rawBody: true` makes Nest expose
  // the original body Buffer as `req.rawBody` IN ADDITION TO the normal
  // parsed `req.body` — every other route's JSON parsing is unaffected, only
  // upi-webhook.controller.ts reads req.rawBody.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Security headers, applied before anything else (CORS, ValidationPipe,
  // route handlers) so they land on EVERY response this server ever sends —
  // including ones CORS would reject with a 403 or the ValidationPipe would
  // reject with a 400. Those are still HTTP responses to a browser, and a
  // browser only honours the headers on the response it actually receives.
  //
  // This app is a pure JSON API — it never renders or serves HTML/CSS/JS of
  // its own (that's apps/web-portal, apps/dsm-app, apps/customer-app) — so
  // the CSP can be maximally strict (`default-src 'none'`, helmet's
  // default) with no risk of breaking a page this server would otherwise
  // need to render.
  app.use(
    helmet({
      contentSecurityPolicy: {
        // No frontend assets are served from this origin, so nothing needs
        // permission to load anything (script/style/img/etc.) from
        // anywhere, including this origin itself.
        directives: {
          defaultSrc: ["'none'"],
        },
      },
      hsts: {
        // includeSubDomains: any subdomain of this API's domain should also
        // only ever be reached over HTTPS.
        includeSubDomains: true,
        // preload deliberately left off: HSTS preload submission is a
        // one-way door (browsers ship it in a hardcoded list; removal takes
        // months to propagate) and we haven't confirmed every subdomain of
        // this deployment is HTTPS-ready yet. Flip this on only after that's
        // verified — don't default to it silently.
        preload: false,
      },
      // frameguard defaults to SAMEORIGIN; nothing about this API should
      // ever be embedded in a frame, same-origin or not, so deny outright.
      frameguard: { action: 'deny' },
      // X-Content-Type-Options: nosniff — this is helmet's default, kept
      // implicit/on here (not disabled) so the browser never guesses a
      // response's MIME type from its content.
    }),
  );

  // Catches anything an application-level try/catch or deliberately-thrown
  // HttpException doesn't — a raw Prisma error, an unexpected bug, etc. —
  // and makes sure the client never sees internals (stack trace, SQL,
  // column names, file paths) regardless of environment. See
  // src/common/filters/global-exception.filter.ts for the full rationale.
  app.useGlobalFilters(new GlobalExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties not declared on the DTO
      transform: true, // auto-convert path/query/body params to DTO types
      forbidNonWhitelisted: true, // reject unexpected fields instead of silently dropping them
    }),
  );
  app.enableCors({
    origin: resolveAllowedOrigins(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    // JWT is sent via the Authorization header (see apps/backend/src/auth),
    // not cookies, so credentialed (cookie-based) CORS requests aren't needed.
    credentials: false,
  });
  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);
  console.log(`Backend listening on port ${port}`);
}
bootstrap().catch((error: unknown) => {
  console.error('Backend failed to start:', error);
  process.exit(1);
});
