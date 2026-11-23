/**
 * Global error handling middleware
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import type { ErrorResponse } from '../types/api.js';
import { config } from '../config/index.js';
import { reportBackendError } from '../lib/failureReporter.js';
import { REPORTED } from './serverErrorReporter.js';

/**
 * Custom application error class
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, string>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Common error factory functions
 */
export const Errors = {
  // Each factory takes an optional stable `code` for errors a client renders from its own string resources. `message`
  // stays English for logs and for clients that do not know the code; the default code is the generic one.
  badRequest: (message: string, details?: Record<string, string>, code = 'BAD_REQUEST') =>
    new AppError(400, code, message, details),

  unauthorized: (message = 'Authentication required') =>
    new AppError(401, 'UNAUTHORIZED', message),

  forbidden: (message = 'Access denied') =>
    new AppError(403, 'FORBIDDEN', message),

  notFound: (resource = 'Resource', code = 'NOT_FOUND') =>
    new AppError(404, code, `${resource} not found`),

  conflict: (message: string, code = 'CONFLICT') =>
    new AppError(409, code, message),

  payloadTooLarge: (maxSize: string) =>
    new AppError(413, 'PAYLOAD_TOO_LARGE', `File exceeds maximum size of ${maxSize}`),

  unprocessable: (message: string, details?: Record<string, string>, code = 'UNPROCESSABLE_ENTITY') =>
    new AppError(422, code, message, details),

  tooManyRequests: (retryAfter?: number) =>
    new AppError(429, 'RATE_LIMITED', 'Too many requests',
      retryAfter ? { retry_after: String(retryAfter) } : undefined),

  internal: (message = 'An unexpected error occurred', code = 'INTERNAL_ERROR') =>
    new AppError(500, code, message),
};

/**
 * Format Zod validation errors
 */
function formatZodError(error: ZodError): Record<string, string> {
  const details: Record<string, string> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.');
    details[path || 'value'] = issue.message;
  }

  return details;
}

/**
 * Global error handler middleware
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response<ErrorResponse>,
  _next: NextFunction
): void {
  // Log error in development
  if (config.NODE_ENV === 'development') {
    console.error('Error:', err);
  }

  // Handle AppError
  if (err instanceof AppError) {
    if (err.statusCode >= 500) (res.locals as Record<symbol, unknown>)[REPORTED] = true;
    reportBackendError(req, err, err.statusCode);
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: formatZodError(err),
      },
    });
    return;
  }

  // Handle JSON parsing errors
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Invalid JSON in request body',
      },
    });
    return;
  }

  // Log unexpected errors
  console.error('Unexpected error:', err);
  (res.locals as Record<symbol, unknown>)[REPORTED] = true;
  reportBackendError(req, err, 500);

  // Generic error response
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: config.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message,
    },
  });
}

/**
 * Async handler wrapper to catch errors in async route handlers
 */
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
