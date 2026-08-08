// ─────────────────────────────────────────────
// All shared TypeScript Types & Interfaces
// ─────────────────────────────────────────────

// Session
export type SessionStatus =
  | 'idle'
  | 'searching'
  | 'matched'
  | 'connected'
  | 'disconnecting'
  | 'terminated';

export interface AnonymousSession {
  sessionId: string;
  socketId?: string;
  peerId?: string;
  peerSocketId?: string;
  roomId?: string;
  country: string;
  language: string;
  interests: string[];
  status: SessionStatus;
  deviceFingerprint: string;
  ipHash: string;
  createdAt: number;
  connectedAt?: number;
  matchedAt?: number;
  reportCount: number;
  isBanned: boolean;
  bannedUntil?: number;
}

// Queue
export interface QueueEntry {
  sessionId: string;
  socketId: string;
  country: string;
  language: string;
  interests: string[];
  joinedAt: number;
  priority: number;
}

export interface MatchResult {
  roomId: string;
  initiatorSessionId: string;
  responderSessionId: string;
  initiatorSocketId: string;
  responderSocketId: string;
  matchedAt: number;
}

// Room
export interface Room {
  roomId: string;
  sessionIds: [string, string];
  socketIds: [string, string];
  createdAt: number;
  status: 'active' | 'closing' | 'closed';
  turnCredentials: TurnCredentials;
}

export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  ttl: number;
}

// Socket Payloads (Client → Server)
export interface JoinQueuePayload {
  country?: string;
  language?: string;
  interests?: string[];
}

export interface ChatMessagePayload {
  roomId: string;
  message: string;
  nonce: string;
  timestamp: number;
}

export interface WebRtcOfferPayload {
  roomId: string;
  sdp: { type: string; sdp: string };
  nonce: string;
}

export interface WebRtcAnswerPayload {
  roomId: string;
  sdp: { type: string; sdp: string };
  nonce: string;
}

export interface WebRtcIceCandidatePayload {
  roomId: string;
  candidate: object;
  nonce: string;
}

export interface ReportPayload {
  roomId: string;
  reason: ReportReason;
  description?: string;
}

export type ReportReason = 'spam' | 'nudity' | 'abuse' | 'underage' | 'other';

// Server → Client Payloads
export interface MatchFoundPayload {
  roomId: string;
  role: 'initiator' | 'responder';
  turnCredentials: TurnCredentials;
  peerCountry?: string;
}

export interface SessionBannedPayload {
  reason: string;
  bannedUntil?: number;
  isPermanent: boolean;
}

export interface SessionErrorPayload {
  code: string;
  message: string;
}

// API Response
export interface ApiResponse<T = void> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  timestamp: number;
}

// Report (DB)
export type ModerationStatus = 'pending' | 'reviewed' | 'actioned' | 'dismissed';
export type ModerationAction = 'warn' | 'ban_temp' | 'ban_perm' | 'dismiss';
export type BanTargetType = 'ip' | 'fingerprint' | 'session';

// Health
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
}

export interface HealthCheckResult {
  status: HealthStatus;
  service: string;
  version: string;
  uptime: number;
  timestamp: number;
  checks: Record<string, ComponentHealth>;
}

// Authenticated socket data
export interface SocketData {
  sessionId: string;
  deviceFingerprint: string;
  country: string;
  language: string;
  interests: string[];
  ipHash: string;
  // Server-populated after a verified match; valid only for this socket's
  // active room and used to avoid repeated Redis authorization reads.
  activeRoomId?: string;
  peerSocketId?: string;
}
