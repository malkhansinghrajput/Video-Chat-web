/**
 * Environment Configuration
 * Parses and validates all environment variables from .env
 * Uses dotenv to load the .env file
 */

import { config } from 'dotenv';
import path from 'path';

// Load .env from project root (backend directory)
config({ path: path.resolve(__dirname, '../../.env') });

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function optionalBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (!val) return fallback;
  return val.toLowerCase() === 'true' || val === '1';
}

function secret(key: string, developmentFallback: string): string {
  const value = process.env[key];
  if (value) return value;
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(`Missing required environment variable in production: ${key}`);
  }
  return developmentFallback;
}

export const env = {
  // App
  NODE_ENV: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',
  PORT: optionalInt('PORT', 3001),
  SERVICE_NAME: optional('SERVICE_NAME', 'api'),
  LOG_LEVEL: optional('LOG_LEVEL', 'debug'),

  // Security
  SESSION_HMAC_SECRET: secret('SESSION_HMAC_SECRET', 'change-me-in-development-minimum-32-chars!!'),
  NONCE_TTL_SECONDS: optionalInt('NONCE_TTL_SECONDS', 60),

  // CORS
  CORS_ORIGIN: optional('CORS_ORIGIN', 'http://localhost:5173,http://localhost:3000'),

  // MongoDB
  MONGODB_URI: optional('MONGODB_URI', 'mongodb://localhost:27017/videochat_dev'),
  MONGODB_DB_NAME: optional('MONGODB_DB_NAME', 'videochat_dev'),

  // Redis
  REDIS_HOST: optional('REDIS_HOST', 'localhost'),
  REDIS_PORT: optionalInt('REDIS_PORT', 6379),
  REDIS_USERNAME: optional('REDIS_USERNAME', 'default'),
  REDIS_PASSWORD: optional('REDIS_PASSWORD', ''),
  REDIS_URL: optional('REDIS_URL', ''),
  REDIS_DISABLED: optionalBool('REDIS_DISABLED', false),
  REDIS_TLS: optionalBool('REDIS_TLS', false),
  REDIS_ERROR_LOG_INTERVAL_MS: optionalInt('REDIS_ERROR_LOG_INTERVAL_MS', 60_000),

  // TURN / Coturn
  TURN_SERVER_URLS: optional('TURN_SERVER_URLS', 'stun:stun.l.google.com:19302'),
  TURN_SERVER_SECRET: secret('TURN_SERVER_SECRET', 'change-me-turn-shared-secret'),
  ADMIN_API_TOKEN: secret('ADMIN_API_TOKEN', 'development-admin-token'),
  TURN_CREDENTIAL_TTL_SECONDS: optionalInt('TURN_CREDENTIAL_TTL_SECONDS', 3600),


  // Rate Limits
  RATE_LIMIT_SESSION_INIT_MAX: optionalInt('RATE_LIMIT_SESSION_INIT_MAX', 3),
  RATE_LIMIT_SESSION_INIT_WINDOW_HOURS: optionalInt('RATE_LIMIT_SESSION_INIT_WINDOW_HOURS', 1),
  RATE_LIMIT_API_MAX: optionalInt('RATE_LIMIT_API_MAX', 100),
  RATE_LIMIT_API_WINDOW_SECONDS: optionalInt('RATE_LIMIT_API_WINDOW_SECONDS', 60),
  RATE_LIMIT_NEXT_MAX: optionalInt('RATE_LIMIT_NEXT_MAX', 10),
  RATE_LIMIT_NEXT_WINDOW_SECONDS: optionalInt('RATE_LIMIT_NEXT_WINDOW_SECONDS', 60),
  RATE_LIMIT_MSG_MAX: optionalInt('RATE_LIMIT_MSG_MAX', 10),
  RATE_LIMIT_MSG_WINDOW_SECONDS: optionalInt('RATE_LIMIT_MSG_WINDOW_SECONDS', 10),
  RATE_LIMIT_REPORT_MAX: optionalInt('RATE_LIMIT_REPORT_MAX', 5),
  RATE_LIMIT_REPORT_WINDOW_HOURS: optionalInt('RATE_LIMIT_REPORT_WINDOW_HOURS', 24),

  // Matching Engine
  MATCH_POLL_INTERVAL_MS: optionalInt('MATCH_POLL_INTERVAL_MS', 50),
  MATCH_COUNTRY_RELAXATION_SECONDS: optionalInt('MATCH_COUNTRY_RELAXATION_SECONDS', 5),
  MATCH_LANGUAGE_RELAXATION_SECONDS: optionalInt('MATCH_LANGUAGE_RELAXATION_SECONDS', 10),
  MATCH_INTEREST_RELAXATION_SECONDS: optionalInt('MATCH_INTEREST_RELAXATION_SECONDS', 15),
  MATCH_GLOBAL_FALLBACK_SECONDS: optionalInt('MATCH_GLOBAL_FALLBACK_SECONDS', 30),
  QUEUE_ENTRY_TTL_SECONDS: optionalInt('QUEUE_ENTRY_TTL_SECONDS', 60),
  QUEUE_CLEANUP_INTERVAL_MS: optionalInt('QUEUE_CLEANUP_INTERVAL_MS', 5_000),
  QUEUE_CLEANUP_BATCH_SIZE: optionalInt('QUEUE_CLEANUP_BATCH_SIZE', 100),
  MATCH_CANDIDATE_BATCH_SIZE: optionalInt('MATCH_CANDIDATE_BATCH_SIZE', 1_000),

  // Moderation
  AUTO_BAN_REPORT_THRESHOLD: optionalInt('AUTO_BAN_REPORT_THRESHOLD', 10),
  AUTO_BAN_WINDOW_MINUTES: optionalInt('AUTO_BAN_WINDOW_MINUTES', 60),
  AUTO_BAN_DURATION_HOURS: optionalInt('AUTO_BAN_DURATION_HOURS', 24),

  // Session
  SESSION_TTL_SECONDS: optionalInt('SESSION_TTL_SECONDS', 86_400),
  HEARTBEAT_INTERVAL_MS: optionalInt('HEARTBEAT_INTERVAL_MS', 25_000),
  HEARTBEAT_TIMEOUT_MS: optionalInt('HEARTBEAT_TIMEOUT_MS', 5_000),
  RECONNECT_GRACE_PERIOD_MS: optionalInt('RECONNECT_GRACE_PERIOD_MS', 5_000),

  // Metrics
  METRICS_ENABLED: optionalBool('METRICS_ENABLED', true),
  METRICS_PORT: optionalInt('METRICS_PORT', 9101),

  // Matching Engine — Adaptive polling
  MATCH_POLL_IDLE_MS: optionalInt('MATCH_POLL_IDLE_MS', 500),       // slow-poll when queue < 2

  // Queue abuse protection
  NEXT_COOLDOWN_MS: optionalInt('NEXT_COOLDOWN_MS', 2000),           // min delay between skips

  // Redis Pub/Sub retry
  PUBSUB_RETRY_INTERVAL_MS: optionalInt('PUBSUB_RETRY_INTERVAL_MS', 5000),

  // Heartbeat miss detection
  HEARTBEAT_MISS_THRESHOLD: optionalInt('HEARTBEAT_MISS_THRESHOLD', 3),

  // Regional routing (future multi-region, no behavior change now)
  REGION: optional('REGION', 'default'),
} as const;
