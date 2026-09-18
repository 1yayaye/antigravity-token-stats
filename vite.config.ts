import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'antigravity-stats-api',
      configureServer(server) {
        server.middlewares.use('/api/stats', (_req, res) => {
          try {
            const statsPath = require.resolve('./scripts/aggregate-stats.cjs');
            delete require.cache[statsPath];
            const { computeStats } = require('./scripts/aggregate-stats.cjs');
            const stats = computeStats();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(stats));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      },
    },
  ],
  server: {
    port: 5173,
  },
});
