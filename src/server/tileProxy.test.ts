import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { handleTileProxyRequest, normalizeCartoApiKey } from './tileProxy';

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

describe('tileProxy server-side isolation', () => {
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
    const req = { url: '/api/other', method: 'GET' } as IncomingMessage;
    const res = new MockResponse() as unknown as ServerResponse;

    const handled = await handleTileProxyRequest(req, res);
    expect(handled).toBe(false);
  });

  it('rejects unsupported HTTP methods with 405 Method Not Allowed', async () => {
    const req = { url: '/api/tiles/streets/1/0/0.png', method: 'POST' } as IncomingMessage;
    const res = new MockResponse();

    const handled = await handleTileProxyRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(405);
    expect(res.getHeader('allow')).toBe('GET, HEAD');
  });

  it('rejects malformed tile coordinates with 400 Bad Request', async () => {
    const res = new MockResponse();
    const handled = await handleTileProxyRequest(
      { url: '/api/tiles/streets/invalid/path.png', method: 'GET' } as IncomingMessage,
      res as unknown as ServerResponse
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Invalid tile coordinates');
  });

  it('rejects out-of-bounds tile coordinates with 400 Bad Request', async () => {
    // Zoom 2 only has coordinates 0, 1, 2, 3 (2^2 = 4)
    const res = new MockResponse();
    const handled = await handleTileProxyRequest(
      { url: '/api/tiles/streets/2/5/1.png', method: 'GET' } as IncomingMessage,
      res as unknown as ServerResponse
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('out of bounds');
  });

  it('securely forwards CARTO_API_KEY upstream without leaking it to the client', async () => {
    process.env.CARTO_API_KEY = 'super_secret_carto_key_xyz';

    let capturedUpstreamUrl = '';
    const mockImageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header signature

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUpstreamUrl = String(url);
      return new Response(mockImageBytes, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
        },
      });
    }) as unknown as typeof fetch;

    const res = new MockResponse();
    const handled = await handleTileProxyRequest(
      { url: '/api/tiles/streets/3/2/1.png', method: 'GET' } as IncomingMessage,
      res as unknown as ServerResponse
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toBe('image/png');
    expect(res.getHeader('cache-control')).toContain('public');
    expect(res.rawBody).toEqual(mockImageBytes);

    // Verify upstream request contained the key
    expect(capturedUpstreamUrl).toContain('super_secret_carto_key_xyz');
    expect(capturedUpstreamUrl).toContain('rastertiles/voyager/3/2/1.png');

    // CRITICAL: Verify client response contains ZERO trace of the key
    for (const [headerName, headerVal] of Object.entries(res.headers)) {
      expect(headerVal).not.toContain('super_secret_carto_key_xyz');
      expect(headerName).not.toContain('key');
    }
    expect(res.body).not.toContain('super_secret_carto_key_xyz');
  });

  it('works cleanly without CARTO_API_KEY using anonymous upstream', async () => {
    delete process.env.CARTO_API_KEY;

    let capturedUpstreamUrl = '';
    const mockImageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUpstreamUrl = String(url);
      return new Response(mockImageBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }) as unknown as typeof fetch;

    const res = new MockResponse();
    const handled = await handleTileProxyRequest(
      { url: '/api/tiles/streets/4/3/2.png', method: 'GET' } as IncomingMessage,
      res as unknown as ServerResponse
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(capturedUpstreamUrl).not.toContain('?key=');
    expect(capturedUpstreamUrl).toContain('rastertiles/voyager/4/3/2.png');
  });

  it('falls back to OpenStreetMap when CARTO upstream is unavailable', async () => {
    let callCount = 0;
    const mockOsmBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      callCount++;
      const urlStr = String(url);
      if (urlStr.includes('cartocdn.com')) {
        return new Response('Upstream Rate Limited', { status: 429 });
      }
      if (urlStr.includes('openstreetmap.org')) {
        return new Response(mockOsmBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch;

    const res = new MockResponse();
    const handled = await handleTileProxyRequest(
      { url: '/api/tiles/streets/2/1/1.png', method: 'GET' } as IncomingMessage,
      res as unknown as ServerResponse
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(callCount).toBe(2);
    expect(res.rawBody).toEqual(mockOsmBytes);
  });
});
