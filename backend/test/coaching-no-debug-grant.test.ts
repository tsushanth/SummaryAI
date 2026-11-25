import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const grantCredits = vi.fn();
const ME = '11111111-1111-4111-8111-111111111111';
const OWN = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
vi.mock('../src/config/index.js', () => ({ config: {} }));
const startSession = vi.fn(async () => ({ sessionId: 's' }));
// A recording is found only for its owner.
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      const where: Record<string, unknown> = {};
      const q: any = { select: () => q, eq: (c: string, v: unknown) => { where[c] = v; return q; } };
      q.maybeSingle = async () => ({ data: where.id === OWN && where.user_id === ME ? { id: OWN } : null, error: null });
      return q;
    },
  },
}));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: ME }; next(); },
}));
vi.mock('../src/services/coachingService.js', () => ({
  grantCredits, getCreditBalance: vi.fn(async () => 0), startSession, endSession: vi.fn(), subscribe: vi.fn(), getInsights: vi.fn(),
  NoCreditsError: class extends Error {}, InvalidPersonaError: class extends Error {},
}));
vi.mock('../src/services/coachingPersonas.js', () => ({ PERSONAS: {} }));
vi.mock('../src/services/googlePlayBilling.js', () => ({ getSubscriptionPurchase: vi.fn(), acknowledgeSubscription: vi.fn() }));

const { default: coachingRoutes } = await import('../src/routes/coaching.js');

describe('coaching credits', () => {
  it('a signed-in user cannot grant themselves credits: the debug route does not exist', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/coaching', coachingRoutes);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/coaching`;
      const res = await fetch(`${base}/credits/grant-debug`, { method: 'POST' });
      expect(res.status).toBe(404);
      expect(grantCredits).not.toHaveBeenCalled();
      // the router itself is mounted and answering
      expect((await fetch(`${base}/personas`)).status).toBe(200);
    } finally {
      server.close();
    }
  });
  it('a session starts only on the caller\'s own recording', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/coaching', coachingRoutes);
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode ?? 500).end());
    const server = app.listen(0);
    try {
      const start = (recording_id: string) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/coaching/sessions`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recording_id, persona: 'sales_discovery' }),
      });
      expect((await start(OTHER)).status).toBe(404);
      expect(startSession).not.toHaveBeenCalled();
      expect((await start(OWN)).status).toBe(201);
    } finally {
      server.close();
    }
  });
});
