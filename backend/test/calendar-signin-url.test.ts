import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const inserted: any[] = [];
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: () => ({ insert: async (row: any) => { inserted.push(row); return { error: null }; } }) } }));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'user-1' }; next(); },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../src/services/encryptionService.js', () => ({ encryptToken: vi.fn(), decryptToken: vi.fn() }));
vi.mock('../src/config/index.js', () => ({
  config: {
    NODE_ENV: 'test',
    GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret', GOOGLE_REDIRECT_URI: 'https://api.test/api/calendar/callback/google',
    MICROSOFT_CLIENT_ID: 'm-id', MICROSOFT_CLIENT_SECRET: 'm-secret', MICROSOFT_REDIRECT_URI: 'https://api.test/api/calendar/callback/microsoft',
  },
}));

const { default: router } = await import('../src/routes/calendar.js');
const { parseOAuthState } = await import('../src/services/googleCalendarService.js');

async function connect(provider: string, headers: Record<string, string> = {}) {
  const app = express();
  app.use('/api/calendar', router);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/calendar/connect/${provider}`, { method: 'POST', headers });
    return new URL(((await res.json()) as { auth_url: string }).auth_url);
  } finally { server.close(); }
}

describe('the sign-in address', () => {
  it('Microsoft: lets the user pick an account and does not force consent, and still asks for a refresh token', async () => {
    const url = await connect('microsoft');
    expect(url.pathname).toBe('/common/oauth2/v2.0/authorize');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('scope')!.split(' ')).toContain('offline_access');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.test/api/calendar/callback/microsoft');
  });

  it('Google: keeps offline access with consent, which is how Google gives a refresh token', async () => {
    const url = await connect('google');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  for (const provider of ['google', 'microsoft']) {
    it(`${provider}: the state remembers whether the website or an app started it, and lasts 15 minutes`, async () => {
      inserted.length = 0;
      const web = await connect(provider, { origin: 'https://meetingmind.org' });
      const app = await connect(provider);
      expect(parseOAuthState(web.searchParams.get('state')!)?.client).toBe('web');
      expect(parseOAuthState(app.searchParams.get('state')!)?.client).toBe('app');
      expect(inserted[0].state).toBe(web.searchParams.get('state'));
      const minutes = (Date.parse(inserted[0].expires_at) - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThanOrEqual(15);
    });
  }
});
