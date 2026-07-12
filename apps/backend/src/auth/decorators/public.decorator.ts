import { SetMetadata } from '@nestjs/common';

// Escape hatch for the global JwtAuthGuard (see app.module.ts APP_GUARD).
// Only /auth/login and the health check should carry this — every other
// route in the app is authenticated by default (CLAUDE.md: never trust the
// frontend to enforce permissions).
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
