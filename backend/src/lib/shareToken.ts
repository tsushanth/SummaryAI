/**
 * Public share link helpers: token generation/hashing, tag normalization and a
 * small in-memory rate limiter for the unauthenticated endpoint.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/** 32 random bytes (256 bits) as base64url = 43 chars. */
export const SHARE_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Trim, collapse whitespace, drop empties, de-dupe case-insensitively, cap count/length. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Fixed-window in-memory limiter. Per-process only (the backend runs a small
 * number of Fly machines); the 256-bit token space is the real protection
 * against enumeration, this just bounds abuse and DB load.
 */
export function createRateLimiter(opts: { windowMs: number; max: number; now?: () => number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? Date.now;
  return function limiter(req: Request, res: Response, next: NextFunction): void {
    const t = now();
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    }
    // Fly sets Fly-Client-IP; X-Forwarded-For is client-spoofable because 'trust proxy' is true.
    const key = (req.headers['fly-client-ip'] as string) || req.ip || 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - t) / 1000)));
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
      return;
    }
    next();
  };
}
