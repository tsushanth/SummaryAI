import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const grantCredits = vi.fn();
vi.mock('../src/config/index.js', () => ({ config: {} }));
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: '11111111-1111-4111-8111-111111111111' }; next(); },
}));
vi.mock('../src/services/coachingService.js', () => ({
  grantCredits, getCreditBalance: vi.fn(async () => 0), startSession: vi.fn(), endSession: vi.fn(), subscribe: vi.fn(), getInsights: vi.fn(),
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
});
