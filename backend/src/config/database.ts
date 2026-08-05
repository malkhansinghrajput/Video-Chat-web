import mongoose from 'mongoose';
import { logger } from './logger';
import { env } from './env';

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on('connecting', () => logger.info('MongoDB: connecting...'));
  mongoose.connection.on('connected', () => logger.info('MongoDB: connected ✓'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB: disconnected'));
  mongoose.connection.on('error', (err: Error) =>
    logger.error('MongoDB: error', { error: err.message }),
  );

  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB_NAME,
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45_000,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('MongoDB: disconnected gracefully');
}

export function getDatabaseHealth(): { status: string; latencyMs?: number } {
  const stateMap: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return { status: stateMap[mongoose.connection.readyState] ?? 'unknown' };
}
