/**
 * pre-deploy-check.ts
 *
 * Run this before deploying to production to verify the environment is
 * correctly configured. Exits with code 1 if any critical check fails.
 *
 * Usage (from backend/ directory):
 *   NODE_ENV=production npx ts-node scripts/pre-deploy-check.ts
 *
 * In CI, set all production env vars and run this as a gate before deploy.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env — scripts/ is one level below backend/, so ../envFile resolves to backend/.env
// (env.ts uses ../../envFile because it lives in src/config/)
const envFile = process.env['ENV_FILE'] ?? '.env';
dotenv.config({ path: path.resolve(__dirname, `../${envFile}`) });

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type Severity = 'CRITICAL' | 'WARN' | 'INFO';
type Status   = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

interface CheckResult {
  name: string;
  status: Status;
  severity: Severity;
  message: string;
}

const results: CheckResult[] = [];
let criticalFailures = 0;

function pass(name: string, message: string, severity: Severity = 'INFO'): void {
  results.push({ name, status: 'PASS', severity, message });
}

function fail(name: string, message: string, severity: Severity = 'CRITICAL'): void {
  results.push({ name, status: 'FAIL', severity, message });
  if (severity === 'CRITICAL') criticalFailures++;
}

function warn(name: string, message: string): void {
  results.push({ name, status: 'WARN', severity: 'WARN', message });
}

function skip(name: string, message: string): void {
  results.push({ name, status: 'SKIP', severity: 'INFO', message });
}

// ─────────────────────────────────────────────
// Known dev placeholder values
// ─────────────────────────────────────────────

const KNOWN_DEV_SECRETS = new Set([
  'change-me-in-production-minimum-32-chars!!',
  'change-me-in-development-minimum-32-chars!!',
  'change-me-turn-shared-secret',
  'dev-turn-secret',
  'development-admin-token',
  'your-secret-here',
  'secret',
  'password',
  'changeme',
]);

function isPlaceholder(value: string): boolean {
  return KNOWN_DEV_SECRETS.has(value);
}

// ─────────────────────────────────────────────
// Checks
// ─────────────────────────────────────────────

function checkNodeEnv(): void {
  const nodeEnv = process.env['NODE_ENV'];
  if (nodeEnv === 'production') {
    pass('NODE_ENV', `NODE_ENV=production ✓`);
  } else {
    fail('NODE_ENV', `NODE_ENV=${nodeEnv ?? '(unset)'} — must be "production" for production deploys`);
  }
}

function checkSecret(envKey: string, minLength = 32): void {
  const value = process.env[envKey];
  if (!value) {
    fail(envKey, `Not set — required in production`);
    return;
  }
  if (isPlaceholder(value)) {
    fail(envKey, `Set to a known dev placeholder value — generate a real secret`);
    return;
  }
  if (value.length < minLength) {
    fail(envKey, `Too short (${value.length} chars) — minimum ${minLength} chars required`);
    return;
  }
  // Show a masked preview, not the actual value
  const preview = `${value.slice(0, 4)}${'*'.repeat(Math.min(8, value.length - 4))}`;
  pass(envKey, `Set (${value.length} chars, starts with ${preview}) ✓`);
}

function checkCorsOrigin(): void {
  const corsOrigin = process.env['CORS_ORIGIN'];
  if (!corsOrigin) {
    warn('CORS_ORIGIN', 'Not set — will default to localhost origins. Set to your frontend URL in production.');
    return;
  }
  const origins = corsOrigin.split(',').map((o) => o.trim());
  if (origins.includes('*')) {
    fail('CORS_ORIGIN', `Contains wildcard "*" — not allowed in production when credentials are enabled`);
    return;
  }
  const hasHttps = origins.every((o) => o.startsWith('https://') || o.startsWith('http://localhost'));
  if (!hasHttps && process.env['NODE_ENV'] === 'production') {
    warn('CORS_ORIGIN', `Contains non-HTTPS origins: ${origins.join(', ')} — production should use HTTPS only`);
    return;
  }
  pass('CORS_ORIGIN', `Origins: ${origins.join(', ')} ✓`);
}

function checkTurnConfig(): void {
  const turnUrls = process.env['TURN_SERVER_URLS'];
  const turnSecret = process.env['TURN_SERVER_SECRET'];

  if (!turnUrls) {
    warn('TURN_SERVER_URLS', 'Not set — TURN is not configured. Users behind symmetric NAT cannot use WebRTC.');
    return;
  }

  const urls = turnUrls.split(',').map((u) => u.trim());
  const hasLocalhost = urls.some((u) => u.includes('localhost') || u.includes('127.0.0.1'));

  if (hasLocalhost) {
    warn('TURN_SERVER_URLS', `Contains localhost URL(s): ${urls.join(', ')} — TURN will be excluded from ICE config in production`);
  } else {
    pass('TURN_SERVER_URLS', `${urls.join(', ')} ✓`);
  }

  if (turnSecret) {
    if (isPlaceholder(turnSecret)) {
      fail('TURN_SERVER_SECRET', 'Set to a known dev placeholder — generate a real shared secret');
    } else if (turnSecret.length < 20) {
      fail('TURN_SERVER_SECRET', `Too short (${turnSecret.length} chars) — minimum 20 chars`);
    } else {
      pass('TURN_SERVER_SECRET', `Set (${turnSecret.length} chars) ✓`);
    }
  } else {
    fail('TURN_SERVER_SECRET', 'Not set — required when TURN_SERVER_URLS is configured');
  }
}

function checkMongoDB(): void {
  const uri = process.env['MONGODB_URI'];
  if (!uri) {
    fail('MONGODB_URI', 'Not set');
    return;
  }
  if (uri.includes('localhost') || uri.includes('127.0.0.1')) {
    warn('MONGODB_URI', 'Points to localhost — use a real MongoDB Atlas URI in production');
  } else {
    // Mask credentials in display
    const maskedUri = uri.replace(/:([^@]+)@/, ':****@');
    pass('MONGODB_URI', `${maskedUri} ✓`);
  }
}

function checkRedis(): void {
  const redisUrl  = process.env['REDIS_URL'];
  const redisHost = process.env['REDIS_HOST'];
  const redisTls  = process.env['REDIS_TLS'];

  const displayUrl = redisUrl
    ? redisUrl.replace(/:([^@]+)@/, ':****@')
    : redisHost
      ? redisHost
      : '(not set)';

  if (!redisUrl && !redisHost) {
    warn('REDIS_HOST/REDIS_URL', 'Neither REDIS_URL nor REDIS_HOST is set — will use localhost:6379');
    return;
  }

  const isLocalhost =
    (redisHost && (redisHost.includes('localhost') || redisHost.includes('127.0.0.1'))) ||
    (redisUrl && (redisUrl.includes('localhost') || redisUrl.includes('127.0.0.1')));

  if (isLocalhost) {
    warn('REDIS_HOST/REDIS_URL', `Points to localhost — use a real Redis instance in production`);
  } else {
    pass('REDIS_HOST/REDIS_URL', `${displayUrl} ✓`);
  }

  if (redisTls === 'true' || redisTls === '1') {
    pass('REDIS_TLS', 'TLS enabled ✓');
  } else {
    warn('REDIS_TLS', 'TLS not enabled — Redis Cloud and most managed Redis providers require TLS in production');
  }
}

function checkRequiredEnvPresent(): void {
  const required = ['PORT', 'SERVICE_NAME'];
  for (const key of required) {
    if (process.env[key]) {
      pass(key, `${process.env[key]} ✓`, 'INFO');
    } else {
      warn(key, `Not set — using default`);
    }
  }
}

async function checkRedisConnectivity(): Promise<void> {
  const redisUrl  = process.env['REDIS_URL'];
  const redisHost = process.env['REDIS_HOST'] ?? 'localhost';
  const redisPort = parseInt(process.env['REDIS_PORT'] ?? '6379', 10);
  const redisPwd  = process.env['REDIS_PASSWORD'];
  const redisTls  = process.env['REDIS_TLS'] === 'true';

  try {
    // Dynamic import to avoid crashing if ioredis is not installed
    const { default: Redis } = await import('ioredis') as { default: typeof import('ioredis').default };

    const client = redisUrl
      ? new Redis(redisUrl, {
          tls: redisTls ? {} : undefined,
          connectTimeout: 5000,
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          enableOfflineQueue: false,
        })
      : new Redis({
          host: redisHost,
          port: redisPort,
          password: redisPwd || undefined,
          tls: redisTls ? {} : undefined,
          connectTimeout: 5000,
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          enableOfflineQueue: false,
        });

    const start = Date.now();
    await client.connect();
    await client.ping();
    const latencyMs = Date.now() - start;
    await client.quit();
    pass('Redis connectivity', `PING → PONG in ${latencyMs}ms ✓`);
  } catch (err) {
    fail('Redis connectivity', `Failed to connect: ${String(err)}`, 'CRITICAL');
  }
}

async function checkMongoConnectivity(): Promise<void> {
  const uri    = process.env['MONGODB_URI'];
  const dbName = process.env['MONGODB_DB_NAME'] ?? 'videochat_dev';

  if (!uri) {
    skip('MongoDB connectivity', 'MONGODB_URI not set — skipping connectivity check');
    return;
  }

  try {
    // Dynamic import
    const mongoose = await import('mongoose');
    const start = Date.now();
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
    const latencyMs = Date.now() - start;
    await mongoose.disconnect();
    pass('MongoDB connectivity', `Connected in ${latencyMs}ms ✓`);
  } catch (err) {
    fail('MongoDB connectivity', `Failed to connect: ${String(err)}`, 'CRITICAL');
  }
}

// ─────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────

function printReport(): void {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  PRE-DEPLOY READINESS CHECK');
  console.log(`  ${new Date().toISOString()}  NODE_ENV=${process.env['NODE_ENV'] ?? '(unset)'}`);
  console.log('═══════════════════════════════════════════════════════');

  const statusIcon: Record<Status, string> = {
    PASS: '✅',
    FAIL: '❌',
    WARN: '⚠️ ',
    SKIP: '⏭️ ',
  };

  for (const r of results) {
    const icon = statusIcon[r.status];
    const sev  = r.status === 'FAIL' ? ` [${r.severity}]` : '';
    console.log(`\n  ${icon} ${r.name}${sev}`);
    console.log(`     ${r.message}`);
  }

  const passed  = results.filter((r) => r.status === 'PASS').length;
  const failed  = results.filter((r) => r.status === 'FAIL').length;
  const warned  = results.filter((r) => r.status === 'WARN').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;

  console.log('\n───────────────────────────────────────────────────────');
  console.log(`  PASSED: ${passed}  FAILED: ${failed}  WARNED: ${warned}  SKIPPED: ${skipped}`);

  if (criticalFailures > 0) {
    console.log(`\n  ❌ DEPLOYMENT BLOCKED — ${criticalFailures} critical issue(s) must be resolved.`);
  } else if (warned > 0) {
    console.log('\n  ⚠️  DEPLOYMENT ALLOWED WITH WARNINGS — review warnings before going live.');
  } else {
    console.log('\n  ✅ ALL CHECKS PASSED — ready for deployment.');
  }
  console.log('═══════════════════════════════════════════════════════\n');
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Running pre-deployment readiness checks...');

  // Static checks (sync)
  checkNodeEnv();
  checkSecret('SESSION_HMAC_SECRET', 32);
  checkSecret('ADMIN_API_TOKEN', 20);
  checkCorsOrigin();
  checkTurnConfig();
  checkMongoDB();
  checkRedis();
  checkRequiredEnvPresent();

  // Connectivity checks (async)
  await checkRedisConnectivity();
  await checkMongoConnectivity();

  printReport();

  process.exit(criticalFailures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Pre-deploy check crashed:', err);
  process.exit(1);
});
