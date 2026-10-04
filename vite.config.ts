import { defineConfig, loadEnv, type Plugin } from 'vite';
import { handleTileProxyRequest } from './src/server/tileProxy.ts';

function tileProxyPlugin(): Plugin {
  return {
    name: 'tile-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handleTileProxyRequest(req, res);
          if (!handled) next();
        } catch (err) {
          next(err);
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handleTileProxyRequest(req, res);
          if (!handled) next();
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

/**
 * Relative base so assets work on GitHub project Pages and custom subpaths.
 * Server proxy middleware securely isolates API keys (e.g. CARTO_API_KEY) from frontend leaks.
 */
export default defineConfig(({ mode }) => {
  // Load environment variables strictly for server-side proxy use
  const env = loadEnv(mode, process.cwd(), '');
  if (env.CARTO_API_KEY && !process.env.CARTO_API_KEY) {
    process.env.CARTO_API_KEY = env.CARTO_API_KEY;
  }

  return {
    base: './',
    server: {
      host: '0.0.0.0',
      port: 3000,
    },
    preview: {
      host: '0.0.0.0',
      port: 3000,
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
    plugins: [tileProxyPlugin()],
  };
});
