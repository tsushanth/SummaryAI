/**
 * Reports EVERY 5xx response, including the ones route handlers send directly with res.status(5xx).json(...) and
 * therefore never reach errorHandler (Stripe/RevenueCat/Twilio webhooks, subscriptions, users, attribution...).
 * errorHandler marks what it already reported so nothing is sent twice. Path only (ids normalised, no query string).
 */
import type { Request, Response, NextFunction } from 'express';
import { reportBackendError } from '../lib/failureReporter.js';

export const REPORTED = Symbol.for('mm.backendErrorReported');

export function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/\d{3,}(?=\/|$)/g, '/:id')
    .replace(/(\/shares\/)[^/]+/, '$1[redacted]');
}

export function serverErrorReporter(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    try {
      if (res.statusCode < 500 || (res.locals as Record<symbol, unknown>)[REPORTED]) return;
      const path = normalizePath(req.originalUrl ? req.originalUrl.split('?')[0] : req.path);
      reportBackendError({ method: req.method, path, user: req.user }, new Error(`HTTP ${res.statusCode} response`), res.statusCode);
    } catch { /* never throws */ }
  });
  next();
}
