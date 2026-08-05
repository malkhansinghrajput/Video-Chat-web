import mongoose from 'mongoose';
import { logger } from './logger';
import { env } from './env';

let memoryServer: any = null;

export async function connectDatabase(): Promise<void> {
  // Prevent double initialization
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    logger.info('MongoDB: already connected or connecting');
    return;
  }

  mongoose.connection.on('connecting', () => logger.info('MongoDB: connecting...'));
  mongoose.connection.on('connected', () => logger.info('MongoDB: connected ✓'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB: disconnected'));
  
  // Only log error once if we're going to fallback to memory server
  const onMongooseError = (err: Error) => logger.error('MongoDB: error', { error: err.message });
  mongoose.connection.on('error', onMongooseError);

  const maxRetries = 5;
  let attempt = 0;
  let connected = false;

  while (attempt < maxRetries && !connected) {
    try {
      attempt++;
      await mongoose.connect(env.MONGODB_URI, {
        dbName: env.MONGODB_DB_NAME,
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45_000,
      });
      connected = true;
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        logger.warn(`MongoDB: connection failed. Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
        await new Promise((res) => setTimeout(res, delay));
      } else {
        if (env.NODE_ENV === 'development') {
          logger.warn('Failed to connect to primary MongoDB after retries. Starting in-memory fallback database for development...', { error: String(err) });
          
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
            throw memErr;
          }
        } else {
          logger.error('MongoDB: Connection failed in production after max retries', { error: String(err) });
          throw err;
        }
      }
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
