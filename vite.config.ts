import { defineConfig, loadEnv, type Plugin } from 'vite';
import { handleTileProxyRequest } from './src/server/tileProxy.ts';
import { handleAuthRequest } from './src/server/auth.ts';
import { handleAiSearchRequest } from './src/server/aiSearch.ts';

function serverApiPlugin(): Plugin {
  return {
    name: 'server-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (await handleAuthRequest(req, res)) return;
          if (await handleTileProxyRequest(req, res)) return;
          if (await handleAiSearchRequest(req, res)) return;
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
          if (await handleAiSearchRequest(req, res)) return;
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
  for (const key of [
    'CARTO_API_KEY',
    'APP_PASSCODE',
    'AI_PASSCODE',
    'JWT_SECRET',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'API_KEY',
    'GOOGLE_GEMINI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
  ]) {
    if (env[key] && !(process.env[key] || '').trim()) {
      process.env[key] = env[key];
    }
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
