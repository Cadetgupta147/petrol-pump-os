import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server is pinned to port 5173 on purpose — apps/backend/src/main.ts
// defaults CORS_ALLOWED_ORIGINS to http://localhost:5173 when unset, so this
// keeps "npm run dev" working against a freshly-cloned backend with no env
// changes required.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
