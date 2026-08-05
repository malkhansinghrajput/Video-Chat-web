import mongoose from 'mongoose';
import { logger } from './logger';
import { env } from './env';

let memoryServer: any = null;

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on('connecting', () => logger.info('MongoDB: connecting...'));
  mongoose.connection.on('connected', () => logger.info('MongoDB: connected ✓'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB: disconnected'));
  
  // Only log error once if we're going to fallback to memory server
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
      logger.warn('Failed to connect to primary MongoDB. Starting in-memory fallback database for development...', { error: String(err) });
      
      try {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        memoryServer = await MongoMemoryServer.create();
        const uri = memoryServer.getUri();
        
        // Remove old error listener to prevent spam from the failed connection attempt
        mongoose.connection.removeListener('error', onMongooseError);
        mongoose.connection.on('error', (err: Error) => logger.error('MongoDB (In-Memory): error', { error: err.message }));

        await mongoose.connect(uri, {
          dbName: env.MONGODB_DB_NAME,
          maxPoolSize: 10,
        });
        logger.info('MongoDB: In-memory fallback connected successfully ✓');
      } catch (memErr) {
        logger.error('MongoDB: Failed to start in-memory fallback', { error: String(memErr) });
      }
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
