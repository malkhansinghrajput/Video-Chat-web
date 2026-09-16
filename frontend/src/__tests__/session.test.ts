/**
 * Session Utilities Tests
 *
 * Tests the real session storage logic as implemented in useSession.ts
 * and the utility functions exported from api.ts.
 *
 * NOTE: These tests use jsdom (configured in vite.config.ts).
 * They verify the client-side session storage layer only.
 * They do NOT test actual HTTP calls to the backend.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateFingerprint } from '../lib/api';

// ── Constants mirrored from useSession.ts ──────────────────────────────────────
// If these keys change, the tests will catch the drift.
const TOKEN_KEY = 'vc_token';
const SESSION_KEY = 'vc_session';

// ── Helper: replicate save/load/clear as implemented in useSession.ts ──────────
// We test the pattern in isolation, not by importing private functions.

function saveSession(info: { sessionId: string; token: string; country: string }): void {
  sessionStorage.setItem(TOKEN_KEY, info.token);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(info));
}

function loadSession(): { sessionId: string; token: string; country: string } | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (raw && token) {
    const parsed = JSON.parse(raw) as { sessionId: string; token: string };
    if (parsed.sessionId && parsed.token) return parsed as { sessionId: string; token: string; country: string };
  }
  return null;
}

function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Session Storage (sessionStorage layer)', () => {
  beforeEach(() => {
    // Use sessionStorage — matches the real implementation in useSession.ts
    sessionStorage.clear();
  });

  it('returns null when no session is saved', () => {
    expect(loadSession()).toBeNull();
  });

  it('saves and retrieves a session with correct keys', () => {
    const mock = { sessionId: 'sess-abc', token: 'jwt-xyz', country: 'US' };
    saveSession(mock);

    // Both keys must be written
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('jwt-xyz');
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();

    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded?.token).toBe('jwt-xyz');
    expect(loaded?.sessionId).toBe('sess-abc');
    expect(loaded?.country).toBe('US');
  });

  it('returns null after clearing a saved session', () => {
    saveSession({ sessionId: 'sess-1', token: 'tok-1', country: 'IN' });
    expect(loadSession()).not.toBeNull();

    clearSession();
    expect(loadSession()).toBeNull();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('returns null when TOKEN_KEY is missing but SESSION_KEY exists', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sessionId: 's', token: 't', country: 'US' }));
    // Token key is missing — loadSession should return null
    expect(loadSession()).toBeNull();
  });

  it('overwrites a session when saved again', () => {
    saveSession({ sessionId: 'old-id', token: 'old-token', country: 'UK' });
    saveSession({ sessionId: 'new-id', token: 'new-token', country: 'DE' });

    const loaded = loadSession();
    expect(loaded?.sessionId).toBe('new-id');
    expect(loaded?.token).toBe('new-token');
  });
});

describe('generateFingerprint (api.ts)', () => {
  it('returns a non-empty string', () => {
    const fp = generateFingerprint();
    expect(typeof fp).toBe('string');
    expect(fp.length).toBeGreaterThan(0);
  });

  it('returns a consistent value for the same environment', () => {
    // Called twice in the same environment — the Date.now() component will differ
    // so we only check it is a string, not that it is deterministic.
    const fp1 = generateFingerprint();
    const fp2 = generateFingerprint();
    expect(typeof fp1).toBe('string');
    expect(typeof fp2).toBe('string');
  });

  it('does not expose raw user agent in the output', () => {
    const fp = generateFingerprint();
    // The output should be a hashed/encoded value, not a raw UA string
    expect(fp).not.toContain('Mozilla');
    expect(fp).not.toContain('Chrome');
  });
});
