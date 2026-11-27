/**
 * What the server answers to someone who does not see phone calls (phone/availability.ts). Nothing here calls Twilio.
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';

export const PHONE_CALLS_OFF_CODE = 'FEATURE_DISABLED';
export const PHONE_CALLS_OFF_MESSAGE = 'Phone calls are no longer available in Meeting Mind.';

/**
 * For /api/phone, after authentication. Released Android versions up to 1.7.13 keep showing the Phone tab, and load two
 * lists when it opens: those answer with a valid empty page, so the app shows its own empty state instead of a load
 * error. Everything else is refused with 404 (a 4xx on purpose: neither the app nor the server reports it as a
 * failure). No answer asks the app to update.
 */
export function phoneCallsApiGate(isShown: (req: Request) => Promise<boolean>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    isShown(req).then((shown) => {
      if (shown) return next();

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
    }).catch(next);
  };
}
