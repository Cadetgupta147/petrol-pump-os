// Name must match the `cacheName` given to the API runtimeCaching rule in
// vite.config.ts. Kept here as the single runtime reference so logout can wipe
// the last-synced API responses — otherwise, on a shared device, the next
// person to log in could see the previous dealer's cached data offline.
const API_CACHE_NAME = 'pumpos-api-cache';

export async function clearApiCache(): Promise<void> {
  if (typeof caches === 'undefined') return; // no Cache API (older browser / SSR)
  try {
    await caches.delete(API_CACHE_NAME);
  } catch {
    // best-effort — a failure here must never block logout
  }
}
