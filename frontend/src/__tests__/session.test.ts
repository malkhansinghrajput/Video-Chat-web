import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStoredSession, setStoredSession, clearStoredSession, API_ENDPOINTS } from '../lib/api';

describe('Session Utilities & API Endpoints', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should get null when no session is saved', () => {
    expect(getStoredSession()).toBeNull();
  });

  it('should set and retrieve stored session correctly', () => {
    const mockSession = {
      token: 'test-jwt-token-123',
      sessionId: 'sess-456',
      expiresAt: Date.now() + 3600000,
    };

    setStoredSession(mockSession);
    const retrieved = getStoredSession();
    expect(retrieved).not.toBeNull();
    expect(retrieved?.token).toBe('test-jwt-token-123');
    expect(retrieved?.sessionId).toBe('sess-456');
  });

  it('should clear stored session', () => {
    setStoredSession({
      token: 'tok',
      sessionId: 'sess',
      expiresAt: Date.now() + 1000,
    });

    clearStoredSession();
    expect(getStoredSession()).toBeNull();
  });

  it('should contain expected API endpoint paths', () => {
    expect(API_ENDPOINTS.SESSION).toBe('/api/v1/session');
    expect(API_ENDPOINTS.ANALYTICS).toBe('/api/v1/analytics');
    expect(API_ENDPOINTS.ICE_SERVERS).toBe('/api/v1/ice-servers');
  });
});
