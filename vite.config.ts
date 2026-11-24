import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'delight-local-wings',
      apply: 'serve',
      async configureServer(server) {
        if (process.env.DELIGHT_WINGS_LOCAL_PREVIEW === '0') return;
        try {
          // Keep the development SQLite service out of Vite's bundled build config.
          const localService = new URL('./scripts/dev-wings.mjs', import.meta.url);
          const { startLocalWings } = await import(localService.href);
          await startLocalWings(server.config.root, server.httpServer);
        } catch (error) {
          server.config.logger.warn(`Local Wings preview: ${String(error)}`);
        }
      },
    },
  ],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/target/**', '**/src-tauri/gen/**'],
    },
  },
});
