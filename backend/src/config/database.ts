import mongoose from 'mongoose';
import { logger } from './logger';
import { env } from './env';

export async function connectDatabase(): Promise<void> {
  // Prevent double initialization
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    logger.info('MongoDB: already connected or connecting');
    return;
  }

  mongoose.connection.on('connecting', () => logger.info('MongoDB: connecting...'));
  mongoose.connection.on('connected', () => logger.info('MongoDB: connected ✓'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB: disconnected'));
  
  const onMongooseError = (err: Error) => logger.error('MongoDB: error', { error: err.message });
  mongoose.connection.on('error', onMongooseError);

  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB_NAME,
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 2000,
      socketTimeoutMS: 45_000,
    });
  } catch (err) {
    if (env.NODE_ENV === 'development') {
      logger.warn('Failed to connect to primary MongoDB. Running in fallback mode.', { error: String(err) });
    } else {
      logger.error('MongoDB: Connection failed in production', { error: String(err) });
      throw err;
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
  }
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
