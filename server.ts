import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleTileProxyRequest } from './src/server/tileProxy.ts';
import { handleAuthRequest } from './src/server/auth.ts';

// Load .env file for local production execution if present
function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        let v = trimmed.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!(k in process.env)) {
          process.env[k] = v;
        }
      }
    }
  }
}

loadEnv();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const DIST_DIR = path.resolve(process.cwd(), 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const server = http.createServer(async (req, res) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Handle auth routes (/api/auth/*)
  try {
    const authHandled = await handleAuthRequest(req, res);
    if (authHandled) return;
  } catch (err) {
    console.error('Auth error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error in auth handler' }));
    }
    return;
  }

  // Handle tile proxy routes (/api/tiles/streets/*)
  try {
    const handled = await handleTileProxyRequest(req, res);
    if (handled) return;
  } catch (err) {
    console.error('Tile proxy error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error in tile proxy' }));
    }
    return;
  }

  // Handle other /api/* routes
  const pathname = (req.url || '/').split('?')[0];
  if (pathname.startsWith('/api/')) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return;
  }

  // Static file serving from dist/
  let sanitizedPath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (sanitizedPath === '/' || sanitizedPath === '') {
    sanitizedPath = '/index.html';
  }

  let filePath = path.join(DIST_DIR, sanitizedPath);

  // If file doesn't exist or is directory, check index.html for SPA fallback
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Not Found. Run npm run build first.');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);

  // Cache static assets aggressively, but keep index.html revalidating
  if (ext === '.html' || ext === '.webmanifest') {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }

  if (req.method === 'HEAD') {
    res.statusCode = 200;
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('File read error');
    }
  });
  stream.pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`World Radio server running on http://${HOST}:${PORT}`);
});
