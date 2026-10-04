const STORAGE_KEY = 'world_radio_jwt';

export interface AuthState {
  authenticated: boolean;
  required: boolean;
  token: string | null;
}

let currentState: AuthState = {
  authenticated: false,
  required: true,
  token: getStoredAuthToken(),
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
      const data = (await res.json()) as { authenticated?: boolean; required?: boolean };
      currentState = {
        authenticated: Boolean(data.authenticated),
        required: Boolean(data.required),
        token: data.authenticated ? token : null,
      };
      if (!data.authenticated && token) {
        setStoredAuthToken(null);
      }
      notify();
      return currentState;
    }
  } catch {
    // If backend is offline or static deploy, assume authenticated if not required
  }

  // Fallback
  currentState = {
    authenticated: Boolean(token),
    required: true,
    token,
  };
  notify();
  return currentState;
}

/** Submit passcode to verify with backend and obtain signed JWT */
export async function verifyPasscode(
  passcode: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ passcode }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      token?: string;
      error?: string;
    };

    if (res.ok && data.token) {
      setStoredAuthToken(data.token);
      currentState = {
        authenticated: true,
        required: true,
        token: data.token,
      };
      notify();
      return { success: true };
    }

    return {
      success: false,
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
