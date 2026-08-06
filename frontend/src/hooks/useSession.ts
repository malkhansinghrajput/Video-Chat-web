/**
 * useSession — manages anonymous session lifecycle
 *
 * On mount:
 *   1. Check sessionStorage for existing token
 *   2. If found → validate with backend
 *   3. If invalid or missing → create new session via POST /api/v1/session/init
 *
 * Stores token + sessionId in sessionStorage so they survive page refreshes
 * but are cleared when the tab is closed.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error' | 'banned';

export interface SessionInfo {
  sessionId: string;
  token: string;
  country: string;
}

interface UseSessionReturn {
  session: SessionInfo | null;
  status: SessionStatus;
  error: string | null;
  /** Call to force re-init (e.g. after ban expiry) */
  reinit: () => void;
}

const TOKEN_KEY = 'vc_token';
const SESSION_KEY = 'vc_session';

function saveSession(info: SessionInfo): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, info.token);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(info));
  } catch { /* quota */ }
}

function loadSession(): SessionInfo | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (raw && token) {
      const parsed = JSON.parse(raw) as SessionInfo;
      if (parsed.sessionId && parsed.token) return parsed;
    }
  } catch { /* parse error */ }
  return null;
}

function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

export function useSession(): UseSessionReturn {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  const init = useCallback(async (force = false) => {
    if (initRef.current && !force) return;
    initRef.current = true;

    setStatus('loading');
    setError(null);

    try {
      // Try existing session first
      const existing = loadSession();
      if (existing && !force) {
        try {
          const validation = await api.validateSession();
          if (validation.data.isBanned) {
            clearSession();
            setStatus('banned');
            return;
          }
          setSession(existing);
          setStatus('ready');
          return;
        } catch {
          // Token expired or invalid — fall through to create new
          clearSession();
        }
      }

      // Create fresh session
      const res = await api.initSession();
      const info: SessionInfo = {
        sessionId: res.data.sessionId,
        token: res.data.token,
        country: res.data.country,
      };
      saveSession(info);
      setSession(info);
      setStatus('ready');

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Session init failed';
      setError(msg);
      setStatus('error');
      initRef.current = false; // allow retry
    }
  }, []);

  useEffect(() => {
    init(false);
  }, [init]);

  const reinit = useCallback(() => {
    clearSession();
    initRef.current = false;
    init(true);
  }, [init]);

  return { session, status, error, reinit };
}
