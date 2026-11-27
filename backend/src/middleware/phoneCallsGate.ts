/**
 * What the server answers while phone calls are switched off (config/featureFlags.ts). Nothing here reads or writes
 * the database or calls Twilio.
 */
import type { Request, Response, NextFunction } from 'express';
import { hasPhoneCalls } from '../config/featureFlags.js';
import { AppError } from './errorHandler.js';

export const PHONE_CALLS_OFF_CODE = 'FEATURE_DISABLED';
export const PHONE_CALLS_OFF_MESSAGE = 'Phone calls are no longer available in Meeting Mind.';

/**
 * For /api/phone, after authentication: per account (feature switch or tester list). Released Android versions keep
 * showing the Phone tab, and load two lists when it opens: those answer with a valid empty page, so the app shows its own
 * empty state instead of a load error. Everything else is refused with 404 (a 4xx on purpose: neither the app nor the
 * server reports it as a failure).
 */
export function phoneCallsApiGate(req: Request, res: Response, next: NextFunction): void {
  if (hasPhoneCalls(req.user?.id)) return next();

  const off = { code: PHONE_CALLS_OFF_CODE, message: PHONE_CALLS_OFF_MESSAGE };
  const path = req.path.replace(/\/+$/, '');
  if (req.method === 'GET' && path === '/verified') {
    res.json({ phones: [], ...off });
    return;
  }
  if (req.method === 'GET' && path === '/calls') {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    res.json({ calls: [], total: 0, limit, offset, ...off });
    return;
  }
  next(new AppError(404, PHONE_CALLS_OFF_CODE, PHONE_CALLS_OFF_MESSAGE));
}
