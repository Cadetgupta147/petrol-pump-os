import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

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
