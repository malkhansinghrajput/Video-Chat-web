// ─────────────────────────────────────────────
// Socket.IO Event Name Constants
// Single source of truth for all event names
// ─────────────────────────────────────────────

export const SocketEvents = {
  // ── Client → Server ──────────────────────
  JOIN_QUEUE: 'join_queue',
  LEAVE_QUEUE: 'leave_queue',
  CHAT_MESSAGE: 'chat:message',
  CHAT_NEXT: 'chat:next',
  CHAT_LEAVE: 'chat:leave',
  WEBRTC_OFFER: 'webrtc:offer',
  WEBRTC_ANSWER: 'webrtc:answer',
  WEBRTC_ICE_CANDIDATE: 'webrtc:ice_candidate',
  REPORT_SUBMIT: 'report:submit',
  HEARTBEAT: 'heartbeat',

  // ── Server → Client ──────────────────────
  QUEUE_JOINED: 'queue:joined',
  QUEUE_POSITION: 'queue:position',
  MATCH_FOUND: 'match:found',
  PEER_JOINED: 'peer:joined',
  PEER_LEFT: 'peer:left',
  PEER_NEXT: 'peer:next',
  CHAT_MESSAGE_INCOMING: 'chat:message:incoming',
  WEBRTC_RESTART: 'webrtc:restart',
  WEBRTC_FAILED: 'webrtc:failed',
  SESSION_BANNED: 'session:banned',
  SESSION_ERROR: 'session:error',
  HEARTBEAT_ACK: 'heartbeat:ack',
} as const;

// ─────────────────────────────────────────────
// Redis Pub/Sub Channels
// ─────────────────────────────────────────────

export const PubSubChannels = {
  MATCH_EVENTS: 'match:events',
  BAN_EVENTS: 'ban:events',
  ADMIN_EVENTS: 'admin:events',
  SESSION_EVENTS: 'session:events',
} as const;

// ─────────────────────────────────────────────
// Redis Key Factory
// ─────────────────────────────────────────────

export const RedisKeys = {
  queue: {
    global: () => 'queue:global',
    byCountry: (cc: string) => `queue:country:${cc}`,
    byLanguage: (lang: string) => `queue:lang:${lang}`,
    matchLock: (id: string) => `match:lock:${id}`,
  },
  session: {
    data: (sessionId: string) => `session:${sessionId}`,
    token: (token: string) => `session:token:${token}`,
    room: (roomId: string) => `room:${roomId}`,
  },
  presence: {
    socket: (socketId: string) => `presence:${socketId}`,
    heartbeat: (sessionId: string) => `heartbeat:${sessionId}`,
  },
  rateLimit: {
    next: (sessionId: string) => `ratelimit:next:${sessionId}`,
    message: (sessionId: string) => `ratelimit:msg:${sessionId}`,
    report: (sessionId: string) => `ratelimit:report:${sessionId}`,
    api: (ipHash: string) => `ratelimit:api:${ipHash}`,
    sessionInit: (ipHash: string) => `ratelimit:init:${ipHash}`,
    joinQueue: (sessionId: string) => `ratelimit:queue:${sessionId}`,
  },
  analytics: {
    concurrentUsers: () => 'stats:concurrent_users',
    queueDepth:      () => 'stats:queue_depth',
    matchCount:      () => 'stats:match_count',
    skipCount:       () => 'stats:skip_count',
    activeRooms:     () => 'stats:active_rooms',
    turnUsage:       () => 'stats:turn_usage',
    avgQueueWait:    () => 'stats:avg_queue_wait_ms',
  },
  nonce: (n: string) => `nonce:${n}`,
  ban: (hash: string) => `ban:${hash}`,
} as const;

// ─────────────────────────────────────────────
// Error Codes
// ─────────────────────────────────────────────

export const ErrorCodes = {
  // Auth
  INVALID_SESSION: 'INVALID_SESSION',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_BANNED: 'SESSION_BANNED',
  // Rate Limit
  RATE_LIMITED: 'RATE_LIMITED',
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  // Room
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  // Queue
  ALREADY_IN_QUEUE: 'ALREADY_IN_QUEUE',
  NOT_IN_QUEUE: 'NOT_IN_QUEUE',
  // General
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  // Report
  REPORT_COOLDOWN: 'REPORT_COOLDOWN',
} as const;

// ─────────────────────────────────────────────
// Application Limits
// ─────────────────────────────────────────────

export const Limits = {
  CHAT_MESSAGE_MAX_LENGTH: 500,
  INTEREST_TAGS_MAX: 10,
  INTERESTS_TAG_MAX_LENGTH: 30,
  QUEUE_ENTRY_TTL_SECONDS: 60,
  SESSION_TTL_SECONDS: 86_400,         // 24h
  HEARTBEAT_INTERVAL_MS: 25_000,
  HEARTBEAT_TIMEOUT_MS: 5_000,
  RECONNECT_GRACE_PERIOD_MS: 5_000,
  ICE_FAILURE_TIMEOUT_MS: 10_000,
  AUTO_BAN_REPORT_THRESHOLD: 10,
  AUTO_BAN_WINDOW_MINUTES: 60,
  AUTO_BAN_DURATION_HOURS: 24,
  MATCH_POLL_INTERVAL_MS: 50,
  MATCH_COUNTRY_RELAX_SECONDS: 5,
  MATCH_LANG_RELAX_SECONDS: 10,
  MATCH_INTEREST_RELAX_SECONDS: 15,
  MATCH_GLOBAL_FALLBACK_SECONDS: 30,
  NONCE_TTL_SECONDS: 60,
  SOCKET_PAYLOAD_MAX_BYTES: 8_192,    // 8 KB
} as const;
