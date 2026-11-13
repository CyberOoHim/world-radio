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

  it('validates general request auth vs AI request auth separately', () => {
    const generalToken = signJwt(
      {
        sub: 'user',
        role: 'listener',
        ai: false,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      getJwtSecret()
    );

    const generalReq = {
      headers: { authorization: `Bearer ${generalToken}` },
    } as unknown as IncomingMessage;
    expect(validateRequestAuth(generalReq)).toBe(true);
    expect(validateAiRequestAuth(generalReq)).toBe(false);

    const aiToken = signJwt(
      {
        sub: 'user',
        role: 'ai_listener',
        ai: true,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      getJwtSecret()
    );
    const aiReq = {
      headers: { authorization: `Bearer ${aiToken}` },
    } as unknown as IncomingMessage;
    expect(validateRequestAuth(aiReq)).toBe(true);
    expect(validateAiRequestAuth(aiReq)).toBe(true);

    const unauthReq = {
      headers: {},
      url: '/api/tiles/streets/1/0/0.png',
    } as unknown as IncomingMessage;
    expect(validateRequestAuth(unauthReq)).toBe(false);
    expect(validateAiRequestAuth(unauthReq)).toBe(false);
  });

  it('ensures general passcodes radio-2026 and world-radio-passcode never authorize AI use', () => {
    delete process.env.APP_PASSCODE;
    delete process.env.AI_PASSCODE;

    expect(evaluatePasscode('radio-2026')).toEqual({ valid: true, aiAuthorized: false });
    expect(evaluatePasscode('world-radio-passcode')).toEqual({ valid: true, aiAuthorized: false });
    expect(evaluatePasscode('wrong-passcode')).toEqual({ valid: false, aiAuthorized: false });

    // Even if misconfigured in env, general passcodes must never authorize AI
    process.env.AI_PASSCODE = 'radio-2026';
    expect(evaluatePasscode('radio-2026')).toEqual({ valid: true, aiAuthorized: false });

    // Dedicated AI_PASSCODE grants AI access while radio-2026 remains general-only
    process.env.APP_PASSCODE = 'radio-2026';
    process.env.AI_PASSCODE = 'secret-ai-key';
    expect(evaluatePasscode('radio-2026')).toEqual({ valid: true, aiAuthorized: false });
    expect(evaluatePasscode('secret-ai-key')).toEqual({ valid: true, aiAuthorized: true });

    // Custom APP_PASSCODE (without AI_PASSCODE) grants AI access, while radio-2026 stays general-only
    delete process.env.AI_PASSCODE;
    process.env.APP_PASSCODE = 'private-studio-pass';
    expect(evaluatePasscode('radio-2026')).toEqual({ valid: true, aiAuthorized: false });
    expect(evaluatePasscode('private-studio-pass')).toEqual({ valid: true, aiAuthorized: true });
  });

  it('issues non-AI JWT for radio-2026 and rejects radio-2026 on AI scope verification', async () => {
    delete process.env.APP_PASSCODE;
    process.env.AI_PASSCODE = 'ai-only-secret';

    // General verification with radio-2026 succeeds with aiAuthorized: false
    const generalReq = createMockPostReq('/api/auth/verify', { passcode: 'radio-2026' });
    const generalRes = createMockRes();
    await handleAuthRequest(generalReq, generalRes.res);
    expect(generalRes.res.statusCode).toBe(200);
    const generalJson = generalRes.getJson();
    expect(generalJson.success).toBe(true);
    expect(generalJson.aiAuthorized).toBe(false);
    const issuedGeneralToken = String(generalJson.token);
    expect(
      validateAiRequestAuth({
        headers: { authorization: `Bearer ${issuedGeneralToken}` },
      } as unknown as IncomingMessage)
    ).toBe(false);

    // AI scope verification with radio-2026 is rejected with 403 AI_AUTH_REQUIRED
    const aiRejectReq = createMockPostReq('/api/auth/verify', {
      passcode: 'radio-2026',
      scope: 'ai',
    });
    const aiRejectRes = createMockRes();
    await handleAuthRequest(aiRejectReq, aiRejectRes.res);
    expect(aiRejectRes.res.statusCode).toBe(403);
    expect(aiRejectRes.getJson().code).toBe('AI_AUTH_REQUIRED');

    // Invalid passcode is rejected with 401
    const badReq = createMockPostReq('/api/auth/verify', { passcode: 'wrong-passcode' });
    const badRes = createMockRes();
    await handleAuthRequest(badReq, badRes.res);
    expect(badRes.res.statusCode).toBe(401);

    // AI_PASSCODE succeeds with aiAuthorized: true
    const aiOkReq = createMockPostReq('/api/auth/verify', {
      passcode: 'ai-only-secret',
      scope: 'ai',
    });
    const aiOkRes = createMockRes();
    await handleAuthRequest(aiOkReq, aiOkRes.res);
    expect(aiOkRes.res.statusCode).toBe(200);
    expect(aiOkRes.getJson().aiAuthorized).toBe(true);
  });
});
