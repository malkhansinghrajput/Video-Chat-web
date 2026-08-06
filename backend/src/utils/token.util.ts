import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';

// ─────────────────────────────────────────────
// Hashing Utilities
// ─────────────────────────────────────────────

/** Hash sensitive data (IP, fingerprint) with a server-side salt */
export function hashSensitiveData(data: string): string {
  return crypto
    .createHmac('sha256', env.SESSION_HMAC_SECRET)
    .update(data.toLowerCase().trim())
    .digest('hex');
}

// ─────────────────────────────────────────────
// Session Token (HMAC-based, stateless validation)
// ─────────────────────────────────────────────

export function generateSessionToken(sessionId: string): string {
  const timestamp = Date.now().toString();
  const payload = `${sessionId}:${timestamp}`;
  const sig = crypto
    .createHmac('sha256', env.SESSION_HMAC_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function verifySessionToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;

    const [sessionId, timestamp, sig] = parts;
    const payload = `${sessionId}:${timestamp}`;
    const expectedSig = crypto
      .createHmac('sha256', env.SESSION_HMAC_SECRET)
      .update(payload)
      .digest('hex');

    // Guard: sig must be same byte length as expectedSig before timingSafeEqual
    // An invalid/truncated sig would cause timingSafeEqual to throw — silently swallowed before
    if (!sig || sig.length !== expectedSig.length) return null;

    const sigBuf      = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');

    // Constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    // Check token age (24 hour TTL)
    const age = Date.now() - parseInt(timestamp, 10);
    if (age > env.SESSION_TTL_SECONDS * 1000) return null;

    return sessionId;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// TURN Credential Generation
// RFC 5389 / coturn time-limited credentials
// ─────────────────────────────────────────────

export function generateTurnCredentials(sessionId: string): {
  username: string;
  credential: string;
  ttl: number;
  urls: string[];
} {
  const ttl = env.TURN_CREDENTIAL_TTL_SECONDS;
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${sessionId}`;
  const credential = crypto
    .createHmac('sha1', env.TURN_SERVER_SECRET)
    .update(username)
    .digest('base64');

  const urls = env.TURN_SERVER_URLS.split(',').map((u) => u.trim());

  return { username, credential, ttl, urls };
}

// ─────────────────────────────────────────────
// ID Generation
// ─────────────────────────────────────────────

export function generateSessionId(): string {
  return `sess_${uuidv4().replace(/-/g, '')}`;
}

export function generateRoomId(): string {
  return `room_${uuidv4().replace(/-/g, '')}`;
}

export function generateNonce(): string {
  return uuidv4();
}
