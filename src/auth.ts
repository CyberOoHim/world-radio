const STORAGE_KEY = 'world_radio_jwt';

export interface AuthState {
  authenticated: boolean;
  aiAuthorized: boolean;
  aiPasscodeConfigured: boolean;
  required: boolean;
  token: string | null;
}

function decodeJwtAiClaim(token: string | null): boolean {
  if (!token) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { ai?: unknown };
    return payload.ai === true;
  } catch {
    return false;
  }
}

const initialToken = getStoredAuthToken();

let currentState: AuthState = {
  authenticated: false,
  aiAuthorized: decodeJwtAiClaim(initialToken),
  aiPasscodeConfigured: false,
  required: true,
  token: initialToken,
};

const listeners = new Set<(state: AuthState) => void>();

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota / private browsing errors
  }
}

export function getAuthState(): AuthState {
  return { ...currentState };
}

export function subscribeAuth(fn: (state: AuthState) => void): () => void {
  listeners.add(fn);
  fn(getAuthState());
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  const state = getAuthState();
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      // Ignore listener error
    }
  }
}

/** Check authentication status with backend */
export async function checkAuthStatus(): Promise<AuthState> {
  const token = getStoredAuthToken();
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch('/api/auth/status', {
      method: 'GET',
      headers,
    });
    if (res.ok) {
      const data = (await res.json()) as {
        authenticated?: boolean;
        aiAuthorized?: boolean;
        aiPasscodeConfigured?: boolean;
        required?: boolean;
      };
      const authenticated = Boolean(data.authenticated);
      currentState = {
        authenticated,
        aiAuthorized: Boolean(data.aiAuthorized),
        aiPasscodeConfigured: Boolean(data.aiPasscodeConfigured),
        required: Boolean(data.required),
        token: authenticated ? token : null,
      };
      if (!authenticated && token) {
        setStoredAuthToken(null);
      }
      notify();
      return currentState;
    }
  } catch {
    // If backend is offline or static deploy, fall back to token presence
  }

  // Fallback
  currentState = {
    authenticated: Boolean(token),
    aiAuthorized: decodeJwtAiClaim(token),
    aiPasscodeConfigured: false,
    required: true,
    token,
  };
  notify();
  return currentState;
}

/** Submit passcode to verify with backend and obtain signed JWT */
export async function verifyPasscode(
  passcode: string,
  scope: 'general' | 'ai' = 'general'
): Promise<{ success: boolean; aiAuthorized?: boolean; code?: string; error?: string }> {
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ passcode, scope }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      aiAuthorized?: boolean;
      aiPasscodeConfigured?: boolean;
      token?: string;
      code?: string;
      error?: string;
    };

    if (res.ok && data.token) {
      const aiAuthorized =
        typeof data.aiAuthorized === 'boolean'
          ? data.aiAuthorized
          : decodeJwtAiClaim(data.token);
      setStoredAuthToken(data.token);
      currentState = {
        authenticated: true,
        aiAuthorized,
        aiPasscodeConfigured: Boolean(data.aiPasscodeConfigured),
        required: true,
        token: data.token,
      };
      notify();
      return { success: true, aiAuthorized };
    }

    return {
      success: false,
      aiAuthorized: Boolean(data.aiAuthorized),
      code: data.code,
      error: data.error || 'Authentication failed. Please check the passcode.',
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error communicating with auth server',
    };
  }
}

/** Logout and clear token */
export async function logoutPasscode(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  } finally {
    setStoredAuthToken(null);
    currentState = {
      authenticated: false,
      aiAuthorized: false,
      aiPasscodeConfigured: currentState.aiPasscodeConfigured,
      required: true,
      token: null,
    };
    notify();
  }
}

/**
 * Returns the tile URL with attached JWT auth token query param
 * to ensure Leaflet <img> requests are securely authenticated.
 */
export function getAuthenticatedTileUrl(baseUrl: string): string {
  const token = getStoredAuthToken();
  if (!token) return baseUrl;

  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
}
