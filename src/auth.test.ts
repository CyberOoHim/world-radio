import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAuthenticatedTileUrl,
  getStoredAuthToken,
  setStoredAuthToken,
  subscribeAuth,
  verifyPasscode,
} from './auth';

describe('client-side auth module', () => {
  let memory: Map<string, string>;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  beforeEach(() => {
    memory = new Map();
    const stub = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memory.set(k, String(v));
      },
      removeItem: (k: string) => {
        memory.delete(k);
      },
      clear: () => memory.clear(),
      key: (i: number) => Array.from(memory.keys())[i] ?? null,
      get length() {
        return memory.size;
      },
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: stub });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('stores and retrieves JWT tokens in localStorage', () => {
    expect(getStoredAuthToken()).toBeNull();
    setStoredAuthToken('sample-jwt-token');
    expect(getStoredAuthToken()).toBe('sample-jwt-token');
    setStoredAuthToken(null);
    expect(getStoredAuthToken()).toBeNull();
  });

  it('attaches token to tile URLs when token is available', () => {
    setStoredAuthToken(null);
    expect(getAuthenticatedTileUrl('/api/tiles/streets/{z}/{x}/{y}.png')).toBe(
      '/api/tiles/streets/{z}/{x}/{y}.png'
    );

    setStoredAuthToken('my-token-123');
    expect(getAuthenticatedTileUrl('/api/tiles/streets/{z}/{x}/{y}.png')).toBe(
      '/api/tiles/streets/{z}/{x}/{y}.png?token=my-token-123'
    );

    expect(getAuthenticatedTileUrl('/api/tiles/streets/{z}/{x}/{y}.png?v=2')).toBe(
      '/api/tiles/streets/{z}/{x}/{y}.png?v=2&token=my-token-123'
    );
  });

  it('verifies guest-radio passcode for map access without granting AI authorization', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          authenticated: true,
          aiAuthorized: false,
          isGuest: true,
          token: 'returned-jwt-456',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    let receivedAuth: boolean | undefined;
    let receivedAiAuth: boolean | undefined;
    let receivedGuest: boolean | undefined;
    const unsub = subscribeAuth((s) => {
      receivedAuth = s.authenticated;
      receivedAiAuth = s.aiAuthorized;
      receivedGuest = s.isGuest;
    });

    const result = await verifyPasscode('guest-radio');
    expect(result.success).toBe(true);
    expect(result.aiAuthorized).toBe(false);
    expect(result.isGuest).toBe(true);
    expect(getStoredAuthToken()).toBe('returned-jwt-456');
    expect(receivedAuth).toBe(true);
    expect(receivedAiAuth).toBe(false);
    expect(receivedGuest).toBe(true);
    unsub();
  });

  it('verifies app passcode with full map and AI authorization', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          authenticated: true,
          aiAuthorized: true,
          isGuest: false,
          token: 'returned-full-jwt',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const result = await verifyPasscode('my-app-passcode');
    expect(result.success).toBe(true);
    expect(result.aiAuthorized).toBe(true);
    expect(result.isGuest).toBe(false);
    expect(getStoredAuthToken()).toBe('returned-full-jwt');
  });

  it('handles incorrect passcode with descriptive error', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Incorrect passcode. Please check and try again.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const result = await verifyPasscode('wrong-code');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Incorrect passcode');
  });
});
