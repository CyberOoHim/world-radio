import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  evaluatePasscode,
  extractAuthToken,
  getAppPasscode,
  getJwtSecret,
  handleAuthRequest,
  signJwt,
  validateAiRequestAuth,
  validateRequestAuth,
  verifyJwt,
} from './auth';

function createMockPostReq(url: string, body: unknown): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage & EventEmitter;
  emitter.url = url;
  emitter.method = 'POST';
  emitter.headers = { 'content-type': 'application/json' };
  queueMicrotask(() => {
    emitter.emit('data', JSON.stringify(body));
    emitter.emit('end');
  });
  return emitter;
}

function createMockRes() {
  const headers: Record<string, string | string[]> = {};
  let body = '';
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk?: string | Buffer) {
      if (chunk) body += chunk.toString();
    },
  } as unknown as ServerResponse;
  return {
    res,
    headers,
    getJson: () => JSON.parse(body || '{}') as Record<string, unknown>,
  };
}

describe('passcode and JWT authentication', () => {
  const secret = 'test-secret-key-12345678901234567890';
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns configured APP_PASSCODE or empty string when unset', () => {
    delete process.env.APP_PASSCODE;
    expect(getAppPasscode()).toBe('');

    process.env.APP_PASSCODE = 'studio-pass';
    expect(getAppPasscode()).toBe('studio-pass');
  });

  it('signs and verifies JWT tokens correctly', () => {
    const payload = {
      sub: 'test_user',
      role: 'listener_full',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const token = signJwt(payload, secret);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const verified = verifyJwt(token, secret);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe('test_user');
    expect(verified?.role).toBe('listener_full');
  });

  it('rejects tampered or forged tokens', () => {
    const payload = {
      sub: 'test_user',
      role: 'guest',
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
      role: 'guest',
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

  it('validates guest map auth vs full app auth separately', () => {
    const guestToken = signJwt(
      {
        sub: 'guest_user',
        role: 'guest',
        ai: false,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      getJwtSecret()
    );

    const guestReq = {
      headers: { authorization: `Bearer ${guestToken}` },
    } as unknown as IncomingMessage;
    expect(validateRequestAuth(guestReq)).toBe(true);
    expect(validateAiRequestAuth(guestReq)).toBe(false);

    const fullToken = signJwt(
      {
        sub: 'authorized_user',
        role: 'listener_full',
        ai: true,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      getJwtSecret()
    );
    const fullReq = {
      headers: { authorization: `Bearer ${fullToken}` },
    } as unknown as IncomingMessage;
    expect(validateRequestAuth(fullReq)).toBe(true);
    expect(validateAiRequestAuth(fullReq)).toBe(true);

    const unauthReq = {
      headers: {},
      url: '/api/tiles/streets/1/0/0.png',
    } as unknown as IncomingMessage;
    expect(validateRequestAuth(unauthReq)).toBe(false);
    expect(validateAiRequestAuth(unauthReq)).toBe(false);
  });

  it('grants map-only access for guest-radio, full access for APP_PASSCODE, and rejects radio-2026', () => {
    delete process.env.APP_PASSCODE;

    // When APP_PASSCODE is unset, guest-radio unlocks map only; radio-2026 is rejected
    expect(evaluatePasscode('guest-radio')).toEqual({
      valid: true,
      aiAuthorized: false,
      isGuest: true,
    });
    expect(evaluatePasscode('radio-2026')).toEqual({
      valid: false,
      aiAuthorized: false,
      isGuest: false,
    });
    expect(evaluatePasscode('world-radio-passcode')).toEqual({
      valid: false,
      aiAuthorized: false,
      isGuest: false,
    });
    expect(evaluatePasscode('wrong-passcode')).toEqual({
      valid: false,
      aiAuthorized: false,
      isGuest: false,
    });

    // Even if APP_PASSCODE is misconfigured as guest-radio, guest-radio must never grant AI access
    process.env.APP_PASSCODE = 'guest-radio';
    expect(evaluatePasscode('guest-radio')).toEqual({
      valid: true,
      aiAuthorized: false,
      isGuest: true,
    });

    // Configured APP_PASSCODE grants both map and AI access; guest-radio stays map-only
    process.env.APP_PASSCODE = 'private-studio-pass';
    expect(evaluatePasscode('guest-radio')).toEqual({
      valid: true,
      aiAuthorized: false,
      isGuest: true,
    });
    expect(evaluatePasscode('private-studio-pass')).toEqual({
      valid: true,
      aiAuthorized: true,
      isGuest: false,
    });
    expect(evaluatePasscode('radio-2026')).toEqual({
      valid: false,
      aiAuthorized: false,
      isGuest: false,
    });
  });

  it('issues guest JWT for guest-radio, rejects radio-2026, and issues full JWT for APP_PASSCODE', async () => {
    process.env.APP_PASSCODE = 'studio-secret-pass';

    // Guest verification with guest-radio succeeds with aiAuthorized: false, isGuest: true
    const guestReq = createMockPostReq('/api/auth/verify', { passcode: 'guest-radio' });
    const guestRes = createMockRes();
    await handleAuthRequest(guestReq, guestRes.res);
    expect(guestRes.res.statusCode).toBe(200);
    const guestJson = guestRes.getJson();
    expect(guestJson.success).toBe(true);
    expect(guestJson.aiAuthorized).toBe(false);
    expect(guestJson.isGuest).toBe(true);
    const issuedGuestToken = String(guestJson.token);
    expect(
      validateRequestAuth({
        headers: { authorization: `Bearer ${issuedGuestToken}` },
      } as unknown as IncomingMessage)
    ).toBe(true);
    expect(
      validateAiRequestAuth({
        headers: { authorization: `Bearer ${issuedGuestToken}` },
      } as unknown as IncomingMessage)
    ).toBe(false);

    // Legacy radio-2026 is rejected with 401
    const legacyReq = createMockPostReq('/api/auth/verify', { passcode: 'radio-2026' });
    const legacyRes = createMockRes();
    await handleAuthRequest(legacyReq, legacyRes.res);
    expect(legacyRes.res.statusCode).toBe(401);

    // Invalid passcode is rejected with 401
    const badReq = createMockPostReq('/api/auth/verify', { passcode: 'wrong-passcode' });
    const badRes = createMockRes();
    await handleAuthRequest(badReq, badRes.res);
    expect(badRes.res.statusCode).toBe(401);

    // APP_PASSCODE succeeds with aiAuthorized: true, isGuest: false
    const appOkReq = createMockPostReq('/api/auth/verify', {
      passcode: 'studio-secret-pass',
    });
    const appOkRes = createMockRes();
    await handleAuthRequest(appOkReq, appOkRes.res);
    expect(appOkRes.res.statusCode).toBe(200);
    expect(appOkRes.getJson().aiAuthorized).toBe(true);
    expect(appOkRes.getJson().isGuest).toBe(false);
  });
});
