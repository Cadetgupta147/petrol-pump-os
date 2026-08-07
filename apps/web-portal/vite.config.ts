import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Dev server is pinned to port 5173 on purpose — apps/backend/src/main.ts
// defaults CORS_ALLOWED_ORIGINS to http://localhost:5173 when unset, so this
// keeps "npm run dev" working against a freshly-cloned backend with no env
// changes required.
export default defineConfig(({ mode }) => {
  // The backend runs on a different origin (localhost:3000 in dev, VITE_API_BASE_URL
  // in prod). We build a RegExp anchored on that origin so the service worker can
  // runtime-cache GET responses from it — this is the "last-synced data offline"
  // half of §15.2. loadEnv (not import.meta.env) because this runs in Node at
  // build time, before the app bundle exists.
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = env.VITE_API_BASE_URL ?? 'http://localhost:3000';
  const apiOrigin = new URL(apiBase).origin;
  const apiOriginPattern = new RegExp(
    '^' + apiOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );

  return {
    plugins: [
      react(),
      VitePWA({
        // 'prompt' (not 'autoUpdate') so a dealer mid-entry isn't reloaded out
        // from under a half-typed bill — ReloadPrompt surfaces a manual
        // "Reload" (see src/components/PwaPrompts.tsx).
        registerType: 'prompt',
        // Precached alongside the JS/CSS shell so they're available offline too.
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'PumpOS — Dealer Dashboard',
          short_name: 'PumpOS',
          description:
            'Petrol pump management — billing, credit, loyalty, and day-end reconciliation.',
          theme_color: '#0f1b33',
          background_color: '#0f1b33',
          display: 'standalone',
          scope: '/',
          start_url: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          // SPA deep links (react-router BrowserRouter) resolve to the precached
          // index.html when offline.
          navigateFallback: '/index.html',
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          runtimeCaching: [
            {
              // GET responses from the backend API. NetworkFirst = always try
              // live, fall back to the last cached copy when the network is
              // down (5s timeout). Only 200s cached; the cache is wiped on
              // logout (clearApiCache) so one dealer's data can't surface for
              // the next login on a shared device.
              urlPattern: apiOriginPattern,
              handler: 'NetworkFirst',
              method: 'GET',
              options: {
                cacheName: 'pumpos-api-cache',
                networkTimeoutSeconds: 5,
                expiration: {
                  maxEntries: 300,
                  maxAgeSeconds: 60 * 60 * 24, // 1 day
                },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
        // Let the SW run in `npm run dev` too, so install/offline can be
        // exercised without a production build.
        devOptions: {
          enabled: true,
          type: 'module',
          navigateFallback: 'index.html',
        },
      }),
    ],
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
