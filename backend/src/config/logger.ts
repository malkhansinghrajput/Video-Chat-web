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

export function logError(msg: string, error: unknown, ctx?: Record<string, unknown>) {
  const details =
    error instanceof Error
      ? { errorMessage: error.message, stack: error.stack }
      : { error: String(error) };
  logger.error(msg, { ...details, ...ctx });
}
