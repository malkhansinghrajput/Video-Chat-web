import winston from 'winston';
import { env } from './env';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp: ts, level, message, correlationId, ...rest }) => {
    const corrId = correlationId ? ` [${String(correlationId)}]` : '';
    const extras = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    return `${String(ts)} [${env.SERVICE_NAME}]${corrId} ${level}: ${String(message)}${extras}`;
  }),
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(),
);

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
  defaultMeta: { service: env.SERVICE_NAME },
  transports: [new winston.transports.Console()],
  exitOnError: false,
});

export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

// ─────────────────────────────────────────────
// Classified error logging
// Adds an `errorType` tag so errors are groupable in log aggregators
// ─────────────────────────────────────────────

type ErrorType =
  | 'REDIS_OOM'
  | 'REDIS_ERROR'
  | 'WEBRTC_FAILED'
  | 'RATE_LIMITED'
  | 'SESSION_ERROR'
  | 'MATCH_ERROR'
  | 'SOCKET_ERROR'
  | 'GENERAL';

function classifyError(error: unknown): ErrorType {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('maxmemory') || msg.includes('OOM')) return 'REDIS_OOM';
  if (msg.includes('Redis') || msg.includes('ECONNREFUSED')) return 'REDIS_ERROR';
  if (msg.includes('WebRTC') || msg.includes('ICE') || msg.includes('SDP')) return 'WEBRTC_FAILED';
  if (msg.includes('rate limit') || msg.includes('RATE')) return 'RATE_LIMITED';
  if (msg.includes('session') || msg.includes('Session')) return 'SESSION_ERROR';
  if (msg.includes('match') || msg.includes('Match')) return 'MATCH_ERROR';
  if (msg.includes('socket') || msg.includes('Socket')) return 'SOCKET_ERROR';
  return 'GENERAL';
}

export function logError(msg: string, error: unknown, ctx?: Record<string, unknown>) {
  const details =
    error instanceof Error
      ? { errorMessage: error.message, stack: error.stack }
      : { error: String(error) };
  logger.error(msg, { ...details, errorType: classifyError(error), ...ctx });
}

// ─────────────────────────────────────────────
// Performance metrics logging
// Use for tracking match duration, queue wait, etc.
// ─────────────────────────────────────────────

export function logPerf(event: string, durationMs: number, ctx?: Record<string, unknown>) {
  logger.info(`[PERF] ${event}`, { durationMs, ...ctx });
}

