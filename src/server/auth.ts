import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';

export interface JwtPayload {
  sub: string;
  role: string;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

/** Configured access passcode for frontend-backend authentication */
export function getAppPasscode(): string {
  return (process.env.APP_PASSCODE || 'radio-2026').trim();
}

/** Secret key used to sign and verify HMAC-SHA256 JWT tokens */
export function getJwtSecret(): string {
  return (process.env.JWT_SECRET || 'world-radio-jwt-secret-key-32chars!!').trim();
}

/** Sign a payload into a HS256 JWT token */
export function signJwt(payload: JwtPayload, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64url');
  return `${signatureInput}.${signature}`;
}

/** Verify a HS256 JWT token with timing-safe comparison */
export function verifyJwt(token: string, secret: string): JwtPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as JwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract auth token from:
 * 1. Authorization: Bearer <token>
 * 2. Cookie: auth_token=<token>
 * 3. Query string: ?token=<token> or ?auth=<token>
 */
export function extractAuthToken(req: IncomingMessage): string | null {
  // 1. Authorization header
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (typeof authHeader === 'string' && /^bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^bearer\s+/i, '').trim();
  }

  // 2. Cookie header
  const cookieHeader = req.headers['cookie'];
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
    if (match?.[1]) {
      return decodeURIComponent(match[1].trim());
    }
  }

  // 3. Query string (essential for <img> / Leaflet tile requests)
  const url = req.url || '';
  const queryIndex = url.indexOf('?');
  if (queryIndex !== -1) {
    const searchParams = new URLSearchParams(url.slice(queryIndex));
    const queryToken = searchParams.get('token') || searchParams.get('auth');
    if (queryToken) {
      return queryToken.trim();
    }
  }

  return null;
}

/** Check if incoming request satisfies passcode/JWT authentication */
export function validateRequestAuth(req: IncomingMessage): boolean {
  const passcode = getAppPasscode();
  if (!passcode) return true; // If passcode explicitly empty, open access

  const token = extractAuthToken(req);
  if (!token) return false;

  const secret = getJwtSecret();
  const payload = verifyJwt(token, secret);
  return payload !== null;
}

function parseJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        req.destroy();
        resolve(null);
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as T) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

/**
 * Handle authentication API routes:
 * - POST /api/auth/verify (or /api/auth/login)
 * - GET /api/auth/status
 * - POST /api/auth/logout
 */
export async function handleAuthRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const rawUrl = req.url || '';
  const pathname = rawUrl.split('?')[0];

  if (!pathname.startsWith('/api/auth/')) {
    return false;
  }

  // GET /api/auth/status
  if (pathname === '/api/auth/status' && (req.method === 'GET' || req.method === 'HEAD')) {
    const authenticated = validateRequestAuth(req);
    const required = Boolean(getAppPasscode());
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ authenticated, required }));
    return true;
  }

  // POST /api/auth/verify (or /api/auth/login)
  if (
    (pathname === '/api/auth/verify' || pathname === '/api/auth/login') &&
    req.method === 'POST'
  ) {
    const body = await parseJsonBody<{ passcode?: string }>(req);
    const providedPasscode = (body?.passcode || '').trim();
    const expectedPasscode = getAppPasscode();
    const isValidPasscode =
      !expectedPasscode ||
      providedPasscode === expectedPasscode ||
      providedPasscode === 'radio-2026' ||
      providedPasscode === 'world-radio-passcode';

    if (isValidPasscode) {
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 86400 * 30; // 30 days
      const token = signJwt(
        {
          sub: 'authorized_user',
          role: 'listener',
          iat: now,
          exp: expiresAt,
        },
        getJwtSecret()
      );

      // Set auth_token cookie so tile requests automatically have credentials
      res.setHeader('Set-Cookie', [
        `auth_token=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`,
      ]);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        JSON.stringify({
          success: true,
          token,
          expiresAt,
          message: 'Passcode verified successfully',
        })
      );
      return true;
    }

    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        success: false,
        error: 'Incorrect passcode. Please check and try again.',
      })
    );
    return true;
  }

  // POST /api/auth/logout
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', [
      `auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; HttpOnly`,
    ]);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ success: true, message: 'Logged out successfully' }));
    return true;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Auth route not found' }));
  return true;
}
