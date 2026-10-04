import { defineConfig, loadEnv, type Plugin } from 'vite';
import { handleTileProxyRequest } from './src/server/tileProxy.ts';
import { handleAuthRequest } from './src/server/auth.ts';

function serverApiPlugin(): Plugin {
  return {
    name: 'server-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (await handleAuthRequest(req, res)) return;
          if (await handleTileProxyRequest(req, res)) return;
          next();
        } catch (err) {
          next(err);
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (await handleAuthRequest(req, res)) return;
          if (await handleTileProxyRequest(req, res)) return;
          next();
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

/**
 * Relative base so assets work on GitHub project Pages and custom subpaths.
 * Server proxy middleware securely handles passcode/JWT auth and tile proxying.
 */
export default defineConfig(({ mode }) => {
  // Load environment variables strictly for server-side proxy use
  const env = loadEnv(mode, process.cwd(), '');
  if (env.CARTO_API_KEY && !process.env.CARTO_API_KEY) {
    process.env.CARTO_API_KEY = env.CARTO_API_KEY;
  }
  if (env.APP_PASSCODE && !process.env.APP_PASSCODE) {
    process.env.APP_PASSCODE = env.APP_PASSCODE;
  }
  if (env.JWT_SECRET && !process.env.JWT_SECRET) {
    process.env.JWT_SECRET = env.JWT_SECRET;
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
    plugins: [serverApiPlugin()],
  };
});
