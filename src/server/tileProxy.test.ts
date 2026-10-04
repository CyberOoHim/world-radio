import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { handleTileProxyRequest, normalizeCartoApiKey } from './tileProxy';
import { getJwtSecret, signJwt } from './auth';

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  bodyChunks: Buffer[] = [];
  ended = false;

  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }

  getHeader(name: string) {
    return this.headers[name.toLowerCase()];
  }

  end(data?: Buffer | string) {
    if (data) {
      this.bodyChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    }
    this.ended = true;
    this.emit('finish');
    return this;
  }

  get body(): string {
    return Buffer.concat(this.bodyChunks).toString('utf8');
  }

  get rawBody(): Buffer {
    return Buffer.concat(this.bodyChunks);
  }
}

function createAuthToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      sub: 'authorized_user',
      role: 'listener',
      iat: now,
      exp: now + 3600,
    },
    getJwtSecret()
  );
}

describe('tileProxy server-side isolation and authentication', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('normalizes CARTO API keys safely server-side', () => {
    expect(normalizeCartoApiKey('')).toBe('');
    expect(normalizeCartoApiKey(null)).toBe('');
    expect(normalizeCartoApiKey('  secret_carto_key_123  ')).toBe('secret_carto_key_123');
    expect(normalizeCartoApiKey('"secret_carto_key_123"')).toBe('secret_carto_key_123');
    expect(normalizeCartoApiKey('key=secret_carto_key_123')).toBe('secret_carto_key_123');
    expect(normalizeCartoApiKey('?key=secret_carto_key_123')).toBe('secret_carto_key_123');
    expect(
      normalizeCartoApiKey(
        'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=secret_carto_key_123'
      )
    ).toBe('secret_carto_key_123');
  });

  it('ignores non-tile requests and returns false to allow next middleware', async () => {
    const req = { url: '/api/other', method: 'GET', headers: {} } as IncomingMessage;
    const res = new MockResponse() as unknown as ServerResponse;

    const handled = await handleTileProxyRequest(req, res);
    expect(handled).toBe(false);
  });

  it('rejects unauthenticated tile requests with 401 Unauthorized', async () => {
    const req = {
      url: '/api/tiles/streets/1/0/0.png',
      method: 'GET',
      headers: {},
    } as IncomingMessage;
    const res = new MockResponse();

    const handled = await handleTileProxyRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('AUTH_REQUIRED');
  });

  it('accepts authenticated requests via Bearer header', async () => {
    const token = createAuthToken();
    const mockImageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    global.fetch = vi.fn(async () => {
      return new Response(mockImageBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }) as unknown as typeof fetch;

    const req = {
      url: '/api/tiles/streets/1/0/0.png',
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    } as IncomingMessage;
    const res = new MockResponse();

    const handled = await handleTileProxyRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toBe('image/png');
  });

  it('accepts authenticated requests via query token parameter', async () => {
    const token = createAuthToken();
    const mockImageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    global.fetch = vi.fn(async () => {
      return new Response(mockImageBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }) as unknown as typeof fetch;

    const req = {
      url: `/api/tiles/streets/1/0/0.png?token=${encodeURIComponent(token)}`,
      method: 'GET',
      headers: {},
    } as IncomingMessage;
    const res = new MockResponse();

    const handled = await handleTileProxyRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('serves OpenStreetMap directly when CARTO_API_KEY is unset (avoids watermark)', async () => {
    delete process.env.CARTO_API_KEY;
    const token = createAuthToken();

    let capturedUrl = '';
    const mockOsmBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]);

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(mockOsmBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }) as unknown as typeof fetch;

    const req = {
      url: '/api/tiles/streets/4/3/2.png',
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    } as IncomingMessage;
    const res = new MockResponse();

    const handled = await handleTileProxyRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    // Verified: Calls OpenStreetMap directly, never triggering CARTO watermark
    expect(capturedUrl).toContain('tile.openstreetmap.org/4/3/2.png');
    expect(capturedUrl).not.toContain('cartocdn.com');
  });

  it('falls back to OpenStreetMap if CARTO returns watermark (wm- in etag)', async () => {
    process.env.CARTO_API_KEY = 'any_key';
    const token = createAuthToken();

    const mockOsmBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x03]);
    let requestedOsm = false;

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('cartocdn.com')) {
        // CARTO sending watermark tile
        return new Response(Buffer.from([0x89]), {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            etag: '"wm-da89c20e77c1-light"',
          },
        });
      }
      if (urlStr.includes('openstreetmap.org')) {
        requestedOsm = true;
        return new Response(mockOsmBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch;

    const req = {
      url: '/api/tiles/streets/2/1/1.png',
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    } as IncomingMessage;
    const res = new MockResponse();

    const handled = await handleTileProxyRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(requestedOsm).toBe(true);
    expect(res.rawBody).toEqual(mockOsmBytes);
  });
});
