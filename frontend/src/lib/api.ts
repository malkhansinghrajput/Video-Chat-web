/**
 * HTTP API client for Video Chat backend
 *
 * URL strategy (single source of truth: VITE_BACKEND_URL):
 *   Dev  (VITE_BACKEND_URL is localhost): use relative path → Vite proxy handles it,
 *         no cross-origin request, no CORS needed.
 *   Prod (VITE_BACKEND_URL is a real https:// URL): use full configured backend URL.
 *         Vite proxy is not running; the browser makes a cross-origin request
 *         and the backend CORS handles it.
 *
 * VITE_API_URL is accepted as a legacy fallback for backward compatibility,
 * but VITE_BACKEND_URL is the canonical variable and takes precedence.
 */

// ── URL resolution ────────────────────────────────────────────────────────────
// Primary: VITE_BACKEND_URL (same variable as socket.ts — one source of truth)
// Fallback: VITE_API_URL (legacy; kept for backward compatibility)

function resolveApiBase(): string {
  // Primary: derive from VITE_BACKEND_URL (mirrors socket.ts logic exactly)
  const backendUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  const isBackendLocalhost =
    backendUrl &&
    (backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1'));

  if (backendUrl && !isBackendLocalhost) {
    // Production: full cross-origin URL, strip trailing slash, append /api/v1
    return `${backendUrl.replace(/\/$/, '')}/api/v1`;
  }

  // Legacy fallback: VITE_API_URL (may be a full URL or undefined)
  const legacyApiUrl = import.meta.env.VITE_API_URL as string | undefined;
  const isLegacyLocalhost =
    legacyApiUrl &&
    (legacyApiUrl.includes('localhost') || legacyApiUrl.includes('127.0.0.1'));

  if (legacyApiUrl && !isLegacyLocalhost) {
    return legacyApiUrl; // Prod: full cross-origin URL from legacy var
  }

  // Dev / localhost / unset: relative path → Vite proxy → backend, no CORS
  return '/api/v1';
}

const BASE: string = resolveApiBase();

// Warn once in production if URL resolution fell back to relative path
if (typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  if (BASE === '/api/v1') {
    console.warn(
      `[VideoChatWeb Config Warning] Neither VITE_BACKEND_URL nor VITE_API_URL ` +
      `is configured as a production URL on host '${window.location.hostname}'. ` +
      `API calls will use relative path '${BASE}' which will hit the static frontend ` +
      `and return HTTP 405. Set VITE_BACKEND_URL in your Vercel environment settings ` +
      `to the backend origin (e.g. https://video-chat-web-gluc.onrender.com).`
    );
  }
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function getToken(): string | null {
  return sessionStorage.getItem('vc_token');
}

// ── Internal request ──────────────────────────────────────────────────────────

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
    if (res.status === 405 || res.status === 404) {
      const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      if (!isLocalhost) {
        throw new Error(
          `Backend API not reachable (${res.status} ${res.statusText}). ` +
          `Request hit static host '${window.location.origin}' instead of backend server. ` +
          `Set VITE_BACKEND_URL in your Vercel deployment environment variables ` +
          `to the backend origin (e.g. https://video-chat-web-gluc.onrender.com).`
        );
      }
    }
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw Object.assign(
      new Error(err?.error?.message ?? `HTTP ${res.status}`),
      { status: res.status },
    );
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

// ── Exported BASE (for tests) ─────────────────────────────────────────────────
/** The resolved API base URL. Exported for unit testing only. */
export { BASE as resolvedApiBase };

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
   * Derives the base URL from VITE_BACKEND_URL (same localhost-safety guard as
   * the rest of this file). Falls back to a same-origin relative path when:
   *   - VITE_BACKEND_URL is not set, OR
   *   - VITE_BACKEND_URL is a localhost URL (dev env accidentally shipped)
   *
   * In practice:
   *   - Dev:  Vite proxy routes /health → http://localhost:3001
   *   - Prod: VITE_BACKEND_URL=https://… → full cross-origin URL
   */
  getAnalytics(): Promise<OnlineCountResponse> {
    const configuredBackend = import.meta.env.VITE_BACKEND_URL as string | undefined;
    const isBackendLocalhost =
      configuredBackend &&
      (configuredBackend.includes('localhost') || configuredBackend.includes('127.0.0.1'));

    const analyticsBase =
      configuredBackend && !isBackendLocalhost
        ? configuredBackend.replace(/\/$/, '')  // Prod: full cross-origin URL
        : '';                                    // Dev: relative → Vite proxy

    return fetch(`${analyticsBase}/health/analytics/count`)
      .then((r) => r.json()) as Promise<OnlineCountResponse>;
  },
};
