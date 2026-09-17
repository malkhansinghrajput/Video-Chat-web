/**
 * HTTP API client for Video Chat backend
 * Base URL is proxied via Vite in dev, same-origin in prod
 */

// Safety guard: if VITE_API_URL is set to a localhost/127.0.0.1 address
// but the page is served from a real (non-localhost) host, fall back to the
// same-origin relative path. This prevents a dev .env from breaking production.
const _configuredApiUrl = import.meta.env.VITE_API_URL;
const _isApiUrlLocalhost =
  _configuredApiUrl &&
  (_configuredApiUrl.includes('localhost') || _configuredApiUrl.includes('127.0.0.1'));
const _isPageLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const BASE: string =
  _configuredApiUrl && !(_isApiUrlLocalhost && !_isPageLocalhost)
    ? _configuredApiUrl
    : '/api/v1';

function getToken(): string | null {
  return sessionStorage.getItem('vc_token');
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  auth = false,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth) {
    const token = getToken();
    if (token) headers['X-Session-Token'] = token;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionInitResponse {
  success: boolean;
  data: {
    sessionId: string;
    token: string;
    country: string;
    expiresIn: number;
  };
  timestamp: number;
}

export interface SessionValidateResponse {
  success: boolean;
  data: {
    sessionId: string;
    status: string;
    country: string;
    isBanned: boolean;
  };
  timestamp: number;
}

export interface IceServersResponse {
  success: boolean;
  data: {
    iceServers: RTCIceServer[];
    ttl: number;
  };
  timestamp: number;
}

export interface OnlineCountResponse {
  success?: boolean;
  concurrentUsers: number;
  usersInQueue: number;
  timestamp: number;
}

// ── Simple device fingerprint ─────────────────────────────────────────────────

export function generateFingerprint(): string {
  const ua = navigator.userAgent;
  const screen = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lang = navigator.language;
  const str = `${ua}|${screen}|${tz}|${lang}`;
  // Simple hash
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36) + Date.now().toString(36);
}

// ── API methods ───────────────────────────────────────────────────────────────

export const api = {
  /** Create a new anonymous session */
  initSession(opts?: { language?: string; interests?: string[] }): Promise<SessionInitResponse> {
    const fp = generateFingerprint();
    return request<SessionInitResponse>('POST', '/session/init', {
      deviceFingerprint: fp,
      language: opts?.language ?? navigator.language.slice(0, 5),
      interests: opts?.interests ?? [],
    });
  },

  /** Validate an existing session token */
  validateSession(): Promise<SessionValidateResponse> {
    return request<SessionValidateResponse>('GET', '/session/validate', undefined, true);
  },

  /** Get ICE/TURN server credentials (requires valid session) */
  getIceServers(): Promise<IceServersResponse> {
    return request<IceServersResponse>('GET', '/session/iceservers', undefined, true);
  },

  /**
   * Get live analytics (online count) — hits /health/analytics/count
   *
   * NOTE: This uses a hardcoded relative path that assumes:
   *   - Dev: Vite proxy routes /health → http://localhost:3001
   *   - Prod: Same-origin deployment (frontend and backend on same domain)
   * If the deployment splits frontend/backend onto different origins,
   * this URL will need to be updated or proxied.
   */
  getAnalytics(): Promise<OnlineCountResponse> {
    return fetch('/health/analytics/count')
      .then((r) => r.json()) as Promise<OnlineCountResponse>;
  },
};
