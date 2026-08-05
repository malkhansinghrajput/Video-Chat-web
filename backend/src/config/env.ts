import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  SERVICE_NAME: z.string().default('api'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  SESSION_HMAC_SECRET: z.string().min(16).default('dev-secret-change-in-production-12345'),
  NONCE_TTL_SECONDS: z.coerce.number().default(60),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  MONGODB_URI: z.string().default('mongodb://localhost:27017/videochat_dev'),
  MONGODB_DB_NAME: z.string().default('videochat_dev'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z.string().transform((v) => v === 'true').default('false'),

  TURN_SERVER_URLS: z.string().default('turn:localhost:3478'),
  TURN_SERVER_SECRET: z.string().default('dev-turn-secret'),
  TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().default(3600),

  RATE_LIMIT_API_MAX: z.coerce.number().default(100),
  RATE_LIMIT_API_WINDOW_SECONDS: z.coerce.number().default(60),
  RATE_LIMIT_SESSION_INIT_MAX: z.coerce.number().default(3),
  RATE_LIMIT_SESSION_INIT_WINDOW_HOURS: z.coerce.number().default(1),
  RATE_LIMIT_NEXT_MAX: z.coerce.number().default(10),
  RATE_LIMIT_NEXT_WINDOW_SECONDS: z.coerce.number().default(60),
  RATE_LIMIT_MSG_MAX: z.coerce.number().default(10),
  RATE_LIMIT_MSG_WINDOW_SECONDS: z.coerce.number().default(10),
  RATE_LIMIT_REPORT_MAX: z.coerce.number().default(5),
  RATE_LIMIT_REPORT_WINDOW_HOURS: z.coerce.number().default(24),

  MATCH_POLL_INTERVAL_MS: z.coerce.number().default(50),
  QUEUE_ENTRY_TTL_SECONDS: z.coerce.number().default(60),

  AUTO_BAN_REPORT_THRESHOLD: z.coerce.number().default(10),
  AUTO_BAN_WINDOW_MINUTES: z.coerce.number().default(60),
  AUTO_BAN_DURATION_HOURS: z.coerce.number().default(24),

  SESSION_TTL_SECONDS: z.coerce.number().default(86400),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().default(25000),
  RECONNECT_GRACE_PERIOD_MS: z.coerce.number().default(5000),

  METRICS_ENABLED: z.string().transform((v) => v === 'true').default('true'),
  METRICS_PORT: z.coerce.number().default(9101),
}).refine((data) => {
  if (data.NODE_ENV === 'production') {
    if (data.SESSION_HMAC_SECRET === 'dev-secret-change-in-production-12345') return false;
    if (data.TURN_SERVER_SECRET === 'dev-turn-secret') return false;
    if (data.MONGODB_URI.includes('localhost')) return false;
    if (data.REDIS_HOST.includes('localhost')) return false;
  }
  return true;
}, {
  message: "Production environment MUST use real secrets and remote databases, not development defaults.",
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
