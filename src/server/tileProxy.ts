import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateRequestAuth } from './auth.ts';

/**
 * Normalizes an API key string server-side.
 * Strips wrapping quotes, parameter prefixes, and URL snippets.
 */
export function normalizeCartoApiKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let key = raw.trim();
  if (!key) return '';

  if (key.includes('key=')) {
    const match = key.match(/[?&]key=([^&#\s]+)/) || key.match(/^key=([^&#\s]+)/);
    if (match?.[1]) {
      try {
        key = decodeURIComponent(match[1]);
      } catch {
        key = match[1];
      }
    }
  }

  key = key.replace(/^["']|["']$/g, '').trim();
  return key;
}

const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;

/**
 * Server-side proxy for map tiles.
 *
 * Security & Isolation:
 * - Requires passcode/JWT authentication between frontend and backend.
 * - API keys (such as CARTO_API_KEY) remain strictly isolated on the backend.
 * - When CARTO_API_KEY is not configured or upstream CARTO produces watermarked
 *   "api key required" tiles, cleanly serves high-quality OpenStreetMap standard tiles.
 * - Validates coordinate bounds against zoom levels to prevent SSRF and injection.
 */
export async function handleTileProxyRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const rawUrl = req.url || '';
  const pathname = rawUrl.split('?')[0];

  if (!pathname.startsWith('/api/tiles/streets/')) {
    return false;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return true;
  }

  // 1. Passcode / JWT Authorization check between frontend and backend
  if (!validateRequestAuth(req)) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        error: 'Unauthorized: Passcode authentication required',
        code: 'AUTH_REQUIRED',
      })
    );
    return true;
  }

  const match = pathname.match(/^\/api\/tiles\/streets\/(\d+)\/(\d+)\/(\d+)(@2x)?\.png$/);
  if (!match) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error:
          'Invalid tile coordinates. Expected format: /api/tiles/streets/:z/:x/:y[@2x].png',
      })
    );
    return true;
  }

  const z = parseInt(match[1], 10);
  const x = parseInt(match[2], 10);
  const y = parseInt(match[3], 10);
  const retina = match[4] || '';

  // Validate zoom range (0 to 22)
  if (z < 0 || z > 22) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Zoom level z must be between 0 and 22' }));
    return true;
  }

  // Validate tile coordinates within 2^z grid
  const maxCoord = 2 ** z;
  if (x < 0 || x >= maxCoord || y < 0 || y >= maxCoord) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'Tile coordinates (x, y) are out of bounds for the given zoom level',
      })
    );
    return true;
  }

  // Helper to fetch OpenStreetMap standard tile
  const fetchOsmTile = async (): Promise<boolean> => {
    try {
      const osmUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
      const osmRes = await fetch(osmUrl, {
        headers: {
          'User-Agent': 'World-Radio-Tile-Proxy/1.0 (https://github.com/world_radio)',
          Accept: 'image/png,image/*;q=0.8',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (osmRes.ok) {
        res.statusCode = 200;
        res.setHeader('Content-Type', osmRes.headers.get('content-type') || 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

        if (req.method === 'HEAD') {
          res.end();
          return true;
        }

        const arrayBuffer = await osmRes.arrayBuffer();
        res.end(Buffer.from(arrayBuffer));
        return true;
      }
    } catch {
      // Fallback failed
    }
    return false;
  };

  // Securely read API key from server environment — NEVER exposed to the frontend
  const apiKey = normalizeCartoApiKey(process.env.CARTO_API_KEY);

  // If NO CARTO API key is configured on the server, directly serve OpenStreetMap standard tiles.
  // This completely avoids CARTO returning watermarked "api key required" tiles.
  if (!apiKey) {
    const success = await fetchOsmTile();
    if (success) return true;

    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Failed to retrieve tile from map provider' }));
    return true;
  }

  // When CARTO_API_KEY is configured, request high-resolution CARTO Voyager tiles with the key
  const subdomain = CARTO_SUBDOMAINS[(x + y) % CARTO_SUBDOMAINS.length];
  const upstreamUrl = `https://${subdomain}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}${retina}.png?key=${encodeURIComponent(apiKey)}`;

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'World-Radio-Tile-Proxy/1.0',
        Accept: 'image/png,image/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });

    const etag = (upstreamRes.headers.get('etag') || '').toLowerCase();
    // CARTO returns 'wm-...' etags when watermarking with "api key required"
    const isWatermarked = etag.includes('wm-');

    if (upstreamRes.ok && !isWatermarked) {
      res.statusCode = 200;
      res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      if (req.method === 'HEAD') {
        res.end();
        return true;
      }

      const arrayBuffer = await upstreamRes.arrayBuffer();
      res.end(Buffer.from(arrayBuffer));
      return true;
    }
  } catch {
    // If upstream request fails, gracefully fallback below
  }

  // Graceful fallback to OpenStreetMap standard tile
  const osmSuccess = await fetchOsmTile();
  if (osmSuccess) return true;

  res.statusCode = 502;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Failed to retrieve tile from upstream map provider' }));
  return true;
}
