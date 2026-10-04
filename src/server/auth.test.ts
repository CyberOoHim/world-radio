import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import {
  extractAuthToken,
  getAppPasscode,
  getJwtSecret,
  signJwt,
  validateRequestAuth,
  verifyJwt,
} from './auth';

describe('passcode and JWT authentication', () => {
  const secret = 'test-secret-key-12345678901234567890';

  it('reads the configured passcode or default', () => {
    expect(getAppPasscode()).toBeTruthy();
  });

  it('signs and verifies JWT tokens correctly', () => {
    const payload = {
      sub: 'test_user',
      role: 'listener',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const token = signJwt(payload, secret);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const verified = verifyJwt(token, secret);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe('test_user');
    expect(verified?.role).toBe('listener');
  });

  it('rejects tampered or forged tokens', () => {
    const payload = {
      sub: 'test_user',
      role: 'listener',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = signJwt(payload, secret);

    // Tampered payload
    const parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ ...payload, sub: 'attacker' })).toString('base64url');
    const forged = parts.join('.');

    expect(verifyJwt(forged, secret)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const expiredPayload = {
      sub: 'test_user',
      role: 'listener',
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const token = signJwt(expiredPayload, secret);
    expect(verifyJwt(token, secret)).toBeNull();
  });

  it('extracts tokens from Authorization headers', () => {
    const req = {
      headers: {
        authorization: 'Bearer valid-jwt-token-123',
      },
    } as unknown as IncomingMessage;
    expect(extractAuthToken(req)).toBe('valid-jwt-token-123');
  });

  it('extracts tokens from cookies', () => {
    const req = {
      headers: {
        cookie: 'theme=dark; auth_token=cookie-jwt-456; other=123',
      },
    } as unknown as IncomingMessage;
    expect(extractAuthToken(req)).toBe('cookie-jwt-456');
  });

  it('extracts tokens from query parameters', () => {
    const req = {
      headers: {},
      url: '/api/tiles/streets/1/0/0.png?token=query-jwt-789',
    } as unknown as IncomingMessage;
    expect(extractAuthToken(req)).toBe('query-jwt-789');
  });

  it('validates request auth against configured passcode', () => {
    const token = signJwt(
      {
        sub: 'user',
        role: 'listener',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      getJwtSecret()
    );

    const validReq = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as IncomingMessage;
    expect(validateRequestAuth(validReq)).toBe(true);

    const unauthReq = {
      headers: {},
      url: '/api/tiles/streets/1/0/0.png',
    } as unknown as IncomingMessage;
    expect(validateRequestAuth(unauthReq)).toBe(false);
  });
});
