import type { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { getCorrelationId } from '../utils/geo.util';

/**
 * Attaches a correlation ID to every request for distributed tracing.
 * Sets it on the response header too.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = getCorrelationId(req);
  (req as Request & { correlationId: string }).correlationId = correlationId;
  res.setHeader('X-Request-ID', correlationId);
  next();
}

/**
 * Request logger — logs method, path, status, and duration.
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const correlationId = (req as Request & { correlationId?: string }).correlationId;

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](`${req.method} ${req.path} ${res.statusCode}`, {
      correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      userAgent: req.headers['user-agent'],
    });
  });

  next();
}

/**
 * Global error handler — catches errors from async route handlers.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const correlationId = (req as Request & { correlationId?: string }).correlationId;

  logger.error('Unhandled error', {
    correlationId,
    error: err.message,
    stack: err.stack,
    path: req.path,
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
    timestamp: Date.now(),
  });
}

/**
 * 404 handler for unknown routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
    timestamp: Date.now(),
  });
}
