/**
 * Safe no-Docker dependency preflight. It intentionally performs no writes
 * unless invoked with --write and an explicit staging guard.
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { connectRedis, disconnectRedis, redisMain, redisPub, redisSub } from '../src/config/redis';

const writeMode = process.argv.includes('--write');
const requiredStagingKeys = ['STAGING_MONGODB_URI'];

function fail(message: string): never {
  console.error(`VALIDATION BLOCKED: ${message}`);
  process.exit(2);
}

async function main(): Promise<void> {
  if (env.NODE_ENV !== 'test') fail('NODE_ENV must be test.');
  if (process.env['VALIDATION_ENVIRONMENT'] !== 'staging') fail('VALIDATION_ENVIRONMENT must equal staging.');
  for (const key of requiredStagingKeys) if (!process.env[key]) fail(`${key} is required; production runtime keys are not accepted.`);
  if (!process.env['STAGING_REDIS_HOST'] && !process.env['STAGING_REDIS_URL']) {
    fail('STAGING_REDIS_HOST or STAGING_REDIS_URL is required; production runtime keys are not accepted.');
  }
  if (env.MONGODB_DB_NAME !== 'videochat_loadtest') fail('MONGODB_DB_NAME must be exactly videochat_loadtest.');
  if (writeMode && process.env['VALIDATION_ALLOW_DESTRUCTIVE'] !== 'true') fail('VALIDATION_ALLOW_DESTRUCTIVE=true is required for write checks.');

  const started = Date.now();
  await connectRedis();
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME, maxPoolSize: 10, serverSelectionTimeoutMS: 5000 });
  try {
    const redisPing = await redisMain.ping();
    const mongoPing = await mongoose.connection.db!.admin().ping();
    const indexes = await mongoose.connection.db!.collection('sessions').indexes().catch(() => []);
    console.log(JSON.stringify({ mode: writeMode ? 'write' : 'read-only', redisPing, mongoPing: mongoPing.ok, sessionIndexes: indexes.length, latencyMs: Date.now() - started }));

    if (!writeMode) return;
    const key = `validation:${Date.now()}`;
    await redisMain.multi().set(key, 'ok', 'EX', 30).zadd(`${key}:zset`, Date.now(), 'member').exec();
    const value = await redisMain.get(key);
    const ttl = await redisMain.ttl(key);
    if (value !== 'ok' || ttl <= 0) throw new Error('Redis SET/GET/EXPIRE verification failed');
    await redisPub.publish(`${key}:channel`, 'probe');
    await redisMain.del(key, `${key}:zset`);

    const probes = mongoose.connection.db!.collection('_validation_probes');
    const result = await probes.insertOne({ marker: key, createdAt: new Date() });
    const persisted = await probes.findOne({ _id: result.insertedId });
    await probes.deleteOne({ _id: result.insertedId });
    if (!persisted) throw new Error('MongoDB persistence verification failed');
    console.log('WRITE CHECKS PASSED (only validation-prefixed Redis keys and one deleted probe document were used)');
  } finally {
    await mongoose.disconnect();
    await disconnectRedis();
  }
}

main().catch((error) => { console.error('VALIDATION FAILED:', error instanceof Error ? error.message : error); process.exit(1); });
