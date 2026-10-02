import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const insert = vi.fn(() => Promise.resolve({ error: null }));
let msConfigured = false;

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: vi.fn(() => ({ insert })) } }));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'user-1' }; next(); },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../src/services/microsoftCalendarService.js', () => ({
  MicrosoftCalendarService: {
    isConfigured: () => msConfigured,
    getAuthUrl: (state: string) => `https://login.microsoftonline.com/auth?state=${state}`,
  },
}));
vi.mock('../src/services/googleCalendarService.js', () => ({
  GoogleCalendarService: {},
  generateOAuthState: (userId: string, nonce: string) => userId + '.' + nonce,
  validateOAuthState: vi.fn(),
}));
vi.mock('../src/services/encryptionService.js', () => ({ encryptToken: vi.fn(), decryptToken: vi.fn() }));
vi.mock('../src/config/index.js', () => ({ config: { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(32) } }));

const { default: router } = await import('../src/routes/calendar.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

async function post(path: string) {
  const app = express();
  app.use('/api/calendar', router);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST' });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

beforeEach(() => { insert.mockClear(); msConfigured = false; });

describe('POST /api/calendar/connect/microsoft', () => {
  it('returns a handled 422 (not a 500) and stores no OAuth state when Microsoft is not configured', async () => {
    const { status, body } = await post('/api/calendar/connect/microsoft');
    expect(status).toBe(422);
    expect(body.error.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns the auth URL when configured', async () => {
    msConfigured = true;
    const { status, body } = await post('/api/calendar/connect/microsoft');
    expect(status).toBe(200);
    expect(body.auth_url).toContain('login.microsoftonline.com');
    expect(insert).toHaveBeenCalledOnce();
  });
});
