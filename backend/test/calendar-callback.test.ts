import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import type { AddressInfo } from 'node:net';
import { OAuthExchangeError, oauthProviderCode, callbackProviderCode } from '../src/lib/oauthError.js';
import { findBadRedirectUris } from '../src/lib/startupConfig.js';

const alerts: Array<{ flow: string; code: string; ctx: Record<string, unknown>; throttle?: number }> = [];
vi.mock('../src/lib/alerts.js', () => ({
  reportAlert: (flow: string, code: string, ctx: any = {}, throttle?: number) => { alerts.push({ flow, code, ctx, throttle }); return true; },
}));

const db = {
  state: null as null | Record<string, unknown>,
  upsertError: null as null | { code: string },
  meetingError: null as null | { code: string },
  inserted: [] as any[],
  connectionUpdates: [] as Array<{ id: unknown; values: any }>,
};
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: any = {};
      let update: any = null;
      q.select = () => q;
      q.eq = (_c: string, v: unknown) => {
        if (update) { db.connectionUpdates.push({ id: v, values: update }); return Promise.resolve({ error: null }); }
        return q;
      };
      // delete().eq() is awaited as is, or followed by .select() which returns the row removed (once).
      q.delete = () => ({
        eq: () => Object.assign(Promise.resolve({ error: null }), {
          select: async () => { const data = db.state ? [db.state] : []; db.state = null; return { data, error: null }; },
        }),
      });
      q.limit = () => q;
      q.single = async () => {
        if (table === 'oauth_states') return db.state ? { data: db.state, error: null } : { data: null, error: { code: 'PGRST116' } };
        return { data: null, error: { code: 'PGRST116' } };
      };
      q.maybeSingle = async () => ({ data: table === 'oauth_states' ? db.state : null, error: null });
      q.upsert = () => ({ select: () => ({ single: async () => (db.upsertError ? { data: null, error: db.upsertError } : { data: { id: 'conn-1' }, error: null }) }) });
      q.insert = async (row: any) => { if (!db.meetingError) db.inserted.push(row); return { error: db.meetingError }; };
      q.update = (v: any) => { update = v; return q; };
      return q;
    },
  },
}));
vi.mock('../src/middleware/auth.js', () => ({ authenticate: (_r: any, _s: any, n: any) => n(), optionalAuth: (_r: any, _s: any, n: any) => n() }));
const google = {
  exchangeCode: vi.fn(),
  getUserInfo: vi.fn(),
  getUpcomingEvents: vi.fn(),
};
vi.mock('../src/services/googleCalendarService.js', () => ({
  GoogleCalendarService: google,
  generateOAuthState: () => 's',
  parseOAuthState: (s: string) => (s === 'garbage' ? null : { userId: 'u' }),
  extractMeetingUrl: () => 'https://meet.google.com/abc-defg-hij',
  detectPlatformFromUrl: () => 'google_meet',
}));
vi.mock('../src/services/microsoftCalendarService.js', () => ({
  MicrosoftCalendarService: { exchangeCode: vi.fn(), getUserInfo: vi.fn() },
  extractMicrosoftMeetingUrl: () => null,
  detectMicrosoftPlatformFromUrl: () => 'teams',
}));
vi.mock('../src/services/encryptionService.js', () => ({ encryptToken: (v: string) => `enc:${v}`, decryptToken: (v: string) => v }));
vi.mock('../src/config/index.js', () => ({ config: { NODE_ENV: 'test' } }));

const { calendarCallbackRouter } = await import('../src/routes/calendar.js');

const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15) Chrome/130 Mobile Safari/537.36';
async function callback(query: string, provider = 'google', ua = ANDROID) {
  const app = express();
  app.use(helmet());
  app.use('/api/calendar', calendarCallbackRouter);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/calendar/callback/${provider}?${query}`, { redirect: 'manual', headers: { 'user-agent': ua } });
    const out = { status: res.status, location: res.headers.get('location'), csp: res.headers.get('content-security-policy'), body: await res.text() };
    await new Promise((r) => setTimeout(r, 10)); // initial sync runs after the response
    return out;
  } finally { server.close(); }
}
const only = () => { expect(alerts).toHaveLength(1); return alerts[0]!; };
const validState = () => { db.state = { user_id: 'u', expires_at: new Date(Date.now() + 60_000).toISOString() }; };

beforeEach(() => {
  alerts.length = 0;
  Object.assign(db, { state: null, upsertError: null, meetingError: null });
  db.inserted.length = 0; db.connectionUpdates.length = 0;
  google.exchangeCode.mockReset().mockResolvedValue({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
  google.getUserInfo.mockReset().mockResolvedValue({ id: 'g', email: 'person@example.com' });
  google.getUpcomingEvents.mockReset().mockResolvedValue([{ id: 'e1', etag: '1', start: { dateTime: '2027-01-01T10:00:00Z' } }]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('every calendar callback failure is reported with a reason', () => {
  for (const provider of ['google', 'microsoft']) {
    const P = provider.toUpperCase();
    it(`${provider}: the provider refused (known sign-in: never throttled)`, async () => {
      validState();
      const r = await callback('error=access_denied&error_description=AADSTS65004%3A+User+declined+for+someone%40x.com&state=abc', provider);
      expect(r.location).toContain('summaryai://calendar/error');
      expect(only()).toMatchObject({ flow: 'calendar_connect_failed', code: `${P}_PROVIDER_ERROR`, throttle: 0 });
      expect(only().ctx.provider_error).toMatch(/^access_denied( AADSTS65004)?$/);
      expect(JSON.stringify(only().ctx)).not.toContain('@');
    });
    it(`${provider}: junk requests are reported but throttled`, async () => {
      await callback('', provider);
      expect(only()).toMatchObject({ code: `${P}_MISSING_PARAMS`, throttle: undefined });
      alerts.length = 0;
      await callback('code=c&state=garbage', provider);
      expect(only()).toMatchObject({ code: `${P}_STATE_UNREADABLE`, throttle: undefined });
      alerts.length = 0;
      await callback('code=c&state=unknown', provider);
      expect(only()).toMatchObject({ code: `${P}_STATE_NOT_FOUND`, throttle: undefined });
      alerts.length = 0;
      await callback('error=x&state=unknown', provider);
      expect(only()).toMatchObject({ code: `${P}_PROVIDER_ERROR`, throttle: undefined });
    });
  }
  it('a refusal uses the sign-in up: opening the same URL again is throttled', async () => {
    validState();
    await callback('error=access_denied&state=abc');
    await callback('error=access_denied&state=abc');
    expect(alerts.map((a) => a.throttle)).toEqual([0, undefined]);
  });
  it('expired sign-in', async () => {
    db.state = { user_id: 'u', expires_at: new Date(Date.now() - 1000).toISOString() };
    await callback('code=c&state=abc');
    expect(only()).toMatchObject({ code: 'GOOGLE_STATE_EXPIRED', throttle: 0 });
  });
  it('token exchange refused: carries the provider code', async () => {
    validState();
    google.exchangeCode.mockRejectedValue(new OAuthExchangeError('x', 400, '{"error":"redirect_uri_mismatch","error_description":"secret stuff"}'));
    const r = await callback('code=c&state=abc');
    expect(r.location).toContain('callback_failed');
    expect(only()).toMatchObject({ code: 'GOOGLE_TOKEN_EXCHANGE_FAILED', throttle: 0, ctx: { provider_error: 'redirect_uri_mismatch' } });
  });
  it('profile lookup failed', async () => {
    validState();
    google.getUserInfo.mockRejectedValue(new Error('Failed to get user info'));
    await callback('code=c&state=abc');
    expect(only()).toMatchObject({ code: 'GOOGLE_USERINFO_FAILED', throttle: 0 });
  });
  it('save failed', async () => {
    validState(); db.upsertError = { code: '23505' };
    const r = await callback('code=c&state=abc');
    expect(r.location).toContain('save_failed');
    expect(only()).toMatchObject({ code: 'GOOGLE_SAVE_FAILED', ctx: { code: '23505' } });
  });
});

describe('a successful connection', () => {
  it('imports meetings under the saved connection id (it used an empty id, so nothing was imported)', async () => {
    validState();
    const r = await callback('code=c&state=abc');
    expect(r.location).toContain('summaryai://calendar/connected?provider=google');
    expect(db.inserted).toMatchObject([{ calendar_connection_id: 'conn-1', source: 'calendar' }]);
    expect(db.connectionUpdates.map((u) => u.id)).toEqual(['conn-1']);
    expect(alerts).toEqual([]);
  });
  it('runs one sync per connection at a time, so an event is not imported twice', async () => {
    let release!: (events: unknown[]) => void;
    google.getUpcomingEvents.mockReturnValue(new Promise((r) => { release = r; }));
    validState();
    await callback('code=c&state=abc');
    validState();
    await callback('code=c&state=abc'); // the second sync of conn-1 starts while the first is still fetching
    release([{ id: 'e1', etag: '1', start: { dateTime: '2027-01-01T10:00:00Z' } }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(google.getUpcomingEvents).toHaveBeenCalledTimes(1);
    expect(db.inserted).toHaveLength(1);
  });
  it('reports an initial sync that fails and meetings that cannot be saved', async () => {
    validState();
    google.getUpcomingEvents.mockRejectedValueOnce(new Error('403'));
    await callback('code=c&state=abc');
    expect(only()).toMatchObject({ flow: 'calendar_sync_failed', code: 'INITIAL_SYNC_FAILED' });
    alerts.length = 0; validState(); db.meetingError = { code: '22P02' };
    await callback('code=c&state=abc');
    expect(only()).toMatchObject({ flow: 'calendar_sync_failed', code: 'MEETING_WRITE_FAILED', ctx: { code: '22P02' } });
  });
});

describe('web popup pages', () => {
  it('may run their own script under the site security policy, and only that one', async () => {
    validState();
    const r = await callback('code=c&state=abc', 'google', DESKTOP);
    const nonce = r.body.match(/<script nonce="([^"]+)">/)?.[1];
    expect(nonce).toBeTruthy();
    expect(r.csp).toContain(`script-src 'nonce-${nonce}'`);
    expect(r.body).not.toContain('onclick=');
    const script = r.body.split(/<script[^>]*>/)[1]!.split('</script>')[0]!;
    expect(() => new Function(script)).not.toThrow();
  });
  it('do not reflect markup from the query string', async () => {
    const attack = "</script><img src=x onerror=alert(1)>'";
    const r = await callback(`error=${encodeURIComponent(attack)}`, 'google', DESKTOP);
    expect(r.body).not.toContain('<img');
    expect(r.body.match(/<\/script>/g)).toHaveLength(1);
    const script = r.body.split(/<script[^>]*>/)[1]!.split('</script>')[0]!;
    expect(() => new Function(script)).not.toThrow();
  });
});

describe('provider error codes', () => {
  it('keeps only codes', () => {
    expect(oauthProviderCode(401, '{"error":"invalid_client","error_codes":[7000222],"error_description":"secret"}')).toBe('invalid_client AADSTS7000222');
    expect(oauthProviderCode(502, '<html>')).toBe('HTTP_502');
    expect(callbackProviderCode(['a b<>', 'c'])).toBe('ab');
  });
});

describe('startup check for the redirect URIs', () => {
  const env = (google: string) => ({
    SERVICE_URL: 'https://summary-ai-backend.fly.dev', GOOGLE_REDIRECT_URI: google,
    MICROSOFT_REDIRECT_URI: 'https://summary-ai-backend.fly.dev/api/calendar/callback/microsoft',
  } as NodeJS.ProcessEnv);
  it('flags a stale Cloud Run address left over from the move to Fly', () => {
    expect(findBadRedirectUris(env('https://summary-ai-backend-000000000000.us-central1.run.app/v1/api/calendar/callback/google')))
      .toEqual([{ name: 'GOOGLE_REDIRECT_URI', host: 'summary-ai-backend-000000000000.us-central1.run.app' }]);
  });
  it('accepts both mounted callback paths and rejects a wrong one', () => {
    expect(findBadRedirectUris(env('https://summary-ai-backend.fly.dev/api/calendar/callback/google'))).toEqual([]);
    expect(findBadRedirectUris(env('https://summary-ai-backend.fly.dev/v1/api/calendar/callback/google'))).toEqual([]);
    expect(findBadRedirectUris(env('https://summary-ai-backend.fly.dev/callback'))).toHaveLength(1);
    expect(findBadRedirectUris(env('not a url'))).toEqual([{ name: 'GOOGLE_REDIRECT_URI', host: 'unparseable' }]);
  });
});
