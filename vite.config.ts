import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'delight-local-wings',
      async configureServer(server) {
        if (process.env.DELIGHT_WINGS_LOCAL_PREVIEW === '0') return;
        try {
          const { startLocalWings } = await import('./scripts/dev-wings.mjs');
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
