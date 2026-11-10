import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { FakeDb } from './helpers-fakeDb.js';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';
process.env.RECALL_API_KEY = 'recall-test-key';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/lib/supabase.js', () => ({ get supabaseAdmin() { return h.db; } }));
vi.mock('../src/lib/failureReporter.js', () => ({ reportBackendError: vi.fn() }));
const alerts = vi.hoisted(() => ({ reportAlert: vi.fn(), reportProviderHttpFailure: vi.fn() }));
vi.mock('../src/lib/alerts.js', () => alerts);
vi.mock('../src/middleware/auth.js', () => {
  const who = (req: any) => { const id = req.headers['x-user']; return id ? { id } : null; };
  return {
    authenticate: (req: any, res: any, next: any) => { const u = who(req); if (!u) return res.status(401).json({ error: { code: 'UNAUTHORIZED' } }); req.user = u; next(); },
    optionalAuth: (req: any, _res: any, next: any) => { req.user = who(req) ?? undefined; next(); },
    internalAuth: (_req: any, _res: any, next: any) => next(),
    requireRole: () => (_req: any, _res: any, next: any) => next(),
  };
});
const scheduler = vi.hoisted(() => ({
  scheduleBotJoin: vi.fn(async () => 'job'), cancelScheduledBot: vi.fn(async () => {}), markJobExecuted: vi.fn(async () => {}), markJobFailed: vi.fn(async () => {}),
}));
vi.mock('../src/services/botSchedulerService.js', () => scheduler);
const createBot = vi.hoisted(() => vi.fn());
vi.mock('../src/services/recallService.js', async (orig) => {
  const real = (await orig()) as any;
  return { ...real, RecallService: { createBot } };
});
vi.mock('../src/lib/liveSttControl.js', () => ({ notifyLiveLanguage: vi.fn() }));

const { default: meetingsRouter, meetingsWorkerRouter } = await import('../src/routes/meetings.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { config } = await import('../src/config/index.js');
const cap = await import('../src/services/botUsageCap.js');

const U = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-15T12:00:00.000Z');
const iso = (s: string) => new Date(s).toISOString();
const minutes = (n: number) => n * 60_000;

let db: FakeDb;
const ENV_KEYS = ['BOT_FREE_MONTHLY_CAP_MINUTES', 'BOT_CAP_EXEMPT_USER_IDS', 'BOT_MAX_SESSION_MINUTES', 'BOT_SESSION_LIMIT'] as const;
beforeEach(() => {
  db = new FakeDb();
  h.db = db;
  for (const k of ENV_KEYS) delete (config as any)[k];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  alerts.reportAlert.mockClear();
  createBot.mockReset();
  createBot.mockImplementation(async () => ({ id: 'bot-1', status: 'ready', meeting_url: 'x' }));
  scheduler.markJobFailed.mockClear();
});
afterEach(() => vi.restoreAllMocks());

/** A bot run that joined at `joined` and left `mins` minutes later. */
function seedRun(mins: number, joined = '2026-11-03T10:00:00.000Z', user = U, extra: Record<string, unknown> = {}) {
  return db.seed('bot_runs', {
    user_id: user, status: 'completed', joined_at: iso(joined),
    left_at: new Date(Date.parse(joined) + minutes(mins)).toISOString(), ...extra,
  });
}

describe('configuration fails safe to the default, never to unlimited', () => {
  it.each([undefined, '', '0', '-5', 'abc', '12.5', '1e3', ' ', 'NaN', '99999999'])('cap value %j -> 120', (raw) => {
    (config as any).BOT_FREE_MONTHLY_CAP_MINUTES = raw;
    expect(cap.botMonthlyCapMinutes()).toBe(120);
  });
  it('a valid value is used', () => {
    (config as any).BOT_FREE_MONTHLY_CAP_MINUTES = ' 90 ';
    expect(cap.botMonthlyCapMinutes()).toBe(90);
  });
  it('an invalid value still enforces the default cap', async () => {
    (config as any).BOT_FREE_MONTHLY_CAP_MINUTES = '0';
    seedRun(120);
    const d = await cap.checkBotMonthlyCap(U, NOW);
    expect(d).toMatchObject({ allowed: false, capMinutes: 120 });
  });
  it('invalid session ceiling falls back to 240', () => {
    (config as any).BOT_MAX_SESSION_MINUTES = 'x';
    expect(cap.botMaxSessionMinutes()).toBe(240);
  });
});

describe('checkBotMonthlyCap', () => {
  it('under the cap: allowed, with used / remaining and a session limit equal to what is left', async () => {
    seedRun(60); seedRun(30);
    const d = await cap.checkBotMonthlyCap(U, NOW);
    expect(d).toMatchObject({ allowed: true, reason: 'under_cap', usedMinutes: 90, remainingMinutes: 30, capMinutes: 120, maxSessionSeconds: 30 * 60 });
  });
  it('no usage yet: full allowance', async () => {
    const d = await cap.checkBotMonthlyCap(U, NOW);
    expect(d).toMatchObject({ allowed: true, usedMinutes: 0, remainingMinutes: 120, maxSessionSeconds: 120 * 60 });
  });
  it('exactly at the cap: blocked with reset date = first of next UTC month', async () => {
    seedRun(120);
    const d = await cap.checkBotMonthlyCap(U, NOW);
    expect(d).toMatchObject({ allowed: false, reason: 'cap_reached', usedMinutes: 120, remainingMinutes: 0, resetsAt: '2026-12-01T00:00:00.000Z' });
  });
  it('one minute under the cap is still allowed (59s of a minute is not charged)', async () => {
    seedRun(119);
    expect((await cap.checkBotMonthlyCap(U, NOW)).allowed).toBe(true);
    db.tables.bot_runs = [];
    db.seed('bot_runs', { user_id: U, status: 'completed', joined_at: iso('2026-11-02T10:00:00Z'), left_at: iso('2026-11-02T11:59:59Z') });
    expect((await cap.checkBotMonthlyCap(U, NOW)).allowed).toBe(true);
  });
  it('over the cap: blocked', async () => {
    seedRun(100); seedRun(45);
    const d = await cap.checkBotMonthlyCap(U, NOW);
    expect(d).toMatchObject({ allowed: false, usedMinutes: 145, remainingMinutes: 0 });
  });
  it('session limit: floor of 5 minutes when little is left, ceiling when much is left', async () => {
    seedRun(118);
    expect((await cap.checkBotMonthlyCap(U, NOW)).maxSessionSeconds).toBe(5 * 60);
    db.tables.bot_runs = [];
    (config as any).BOT_FREE_MONTHLY_CAP_MINUTES = '1000';
    expect((await cap.checkBotMonthlyCap(U, NOW)).maxSessionSeconds).toBe(240 * 60);
  });
  it('BOT_SESSION_LIMIT=off sends no session limit but still enforces the cap', async () => {
    (config as any).BOT_SESSION_LIMIT = 'off';
    expect((await cap.checkBotMonthlyCap(U, NOW)).maxSessionSeconds).toBeUndefined();
    seedRun(120);
    expect((await cap.checkBotMonthlyCap(U, NOW)).allowed).toBe(false);
  });

  describe('month rollover (UTC)', () => {
    it('last month does not count; the allowance resets on the 1st', async () => {
      seedRun(200, '2026-10-31T22:00:00.000Z');
      const d = await cap.checkBotMonthlyCap(U, new Date('2026-11-01T00:00:00.000Z'));
      expect(d).toMatchObject({ allowed: true, usedMinutes: 0 });
    });
    it('a run that joined one second before the boundary belongs to the old month', async () => {
      seedRun(130, '2026-10-31T23:59:59.000Z');
      expect((await cap.checkBotMonthlyCap(U, new Date('2026-10-31T23:59:59.500Z'))).allowed).toBe(false);
      expect((await cap.checkBotMonthlyCap(U, new Date('2026-11-01T00:00:00.000Z'))).allowed).toBe(true);
    });
    it('next-month runs are not charged to this month', async () => {
      seedRun(200, '2026-12-01T00:00:00.000Z');
      expect((await cap.checkBotMonthlyCap(U, NOW)).usedMinutes).toBe(0);
    });
    it('December rolls into January of the next year', () => {
      expect(cap.utcMonthWindow(new Date('2026-12-31T23:00:00Z')).next.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });
  });

  describe('what counts as used', () => {
    it('runs that never joined count as zero', async () => {
      db.seed('bot_runs', { user_id: U, status: 'failed', joined_at: null, left_at: null, duration_seconds: 99999 });
      expect((await cap.checkBotMonthlyCap(U, NOW)).usedMinutes).toBe(0);
    });
    it('uses joined->left, not duration_seconds (an estimate for bot recordings)', async () => {
      seedRun(30, undefined, U, { duration_seconds: 99 * 60 });
      expect((await cap.checkBotMonthlyCap(U, NOW)).usedMinutes).toBe(30);
    });
    it('a bot still in the call counts the time so far', async () => {
      db.seed('bot_runs', { user_id: U, status: 'recording', joined_at: new Date(NOW.getTime() - minutes(50)).toISOString(), left_at: null });
      expect((await cap.checkBotMonthlyCap(U, NOW)).usedMinutes).toBe(50);
    });
    it('a stale in-call row (older than the session ceiling, no left_at) is not charged', async () => {
      db.seed('bot_runs', { user_id: U, status: 'recording', joined_at: new Date(NOW.getTime() - minutes(300)).toISOString(), left_at: null });
      expect((await cap.checkBotMonthlyCap(U, NOW)).usedMinutes).toBe(0);
    });
    it('runSeconds is the one shared computation: a stale in-call run is free for the allowance, the ceiling for spend estimates', () => {
      const row = { status: 'recording', joined_at: new Date(NOW.getTime() - minutes(600)).toISOString(), left_at: null, duration_seconds: null };
      expect(cap.runSeconds(row, NOW, 240)).toBe(0);
      expect(cap.runSeconds(row, NOW, 240, 'ceiling')).toBe(240 * 60);
      expect(cap.runSeconds({ ...row, joined_at: new Date(NOW.getTime() - minutes(30)).toISOString() }, NOW, 240, 'ceiling')).toBe(30 * 60);
    });
    it('joined, no left_at, finished: falls back to duration_seconds', async () => {
      db.seed('bot_runs', { user_id: U, status: 'failed', joined_at: iso('2026-11-02T10:00:00Z'), left_at: null, duration_seconds: 20 * 60 });
      expect((await cap.checkBotMonthlyCap(U, NOW)).usedMinutes).toBe(20);
    });
    it("other users' runs are not counted", async () => {
      seedRun(500, undefined, '22222222-2222-4222-8222-222222222222');
      expect((await cap.checkBotMonthlyCap(U, NOW)).usedMinutes).toBe(0);
    });
  });

  describe('exemptions', () => {
    it('allow-listed user (case-insensitive, whitespace tolerant) is never capped and needs no queries', async () => {
      (config as any).BOT_CAP_EXEMPT_USER_IDS = `  other-id , ${U.toUpperCase()} `;
      seedRun(900);
      db.log.length = 0;
      const d = await cap.checkBotMonthlyCap(U, NOW);
      expect(d).toMatchObject({ allowed: true, reason: 'exempt_allowlist' });
      expect(d.maxSessionSeconds).toBeUndefined();
      expect(db.log).toHaveLength(0);
    });
    it('a similar-looking id is not exempt', async () => {
      (config as any).BOT_CAP_EXEMPT_USER_IDS = U.slice(0, -1);
      seedRun(120);
      expect((await cap.checkBotMonthlyCap(U, NOW)).allowed).toBe(false);
    });
    it('paid user (profiles active/trialing) over the cap is allowed, with no session limit', async () => {
      for (const status of ['active', 'trialing']) {
        db.tables.profiles = [];
        db.seed('profiles', { id: U, subscription_status: status });
        seedRun(500);
        const d = await cap.checkBotMonthlyCap(U, NOW);
        expect(d).toMatchObject({ allowed: true, reason: 'paid' });
        expect(d.maxSessionSeconds).toBeUndefined();
        db.tables.bot_runs = [];
      }
    });
    it('paid user under the cap is not limited to the remainder', async () => {
      db.seed('profiles', { id: U, subscription_status: 'active' });
      seedRun(100);
      const d = await cap.checkBotMonthlyCap(U, NOW);
      expect(d).toMatchObject({ allowed: true, reason: 'paid' });
      expect(d.maxSessionSeconds).toBeUndefined();
    });
    it.each(['canceled', 'past_due', 'free', null])('profile status %j is not paid', async (status) => {
      db.seed('profiles', { id: U, subscription_status: status });
      seedRun(120);
      expect((await cap.checkBotMonthlyCap(U, NOW)).allowed).toBe(false);
    });
    it('an expired subscription is not paid', async () => {
      db.seed('profiles', { id: U, subscription_status: 'active', subscription_expires_at: iso('2026-11-01T00:00:00Z') });
      seedRun(120);
      expect((await cap.checkBotMonthlyCap(U, NOW)).allowed).toBe(false);
    });
  });

  describe('lookup failure fails OPEN and is logged loudly', () => {
    it('bot_runs query error -> allowed, no session limit, error logged, alert raised', async () => {
      db.missing.add('bot_runs.joined_at');
      const d = await cap.checkBotMonthlyCap(U, NOW);
      expect(d).toMatchObject({ allowed: true, reason: 'lookup_failed', usedMinutes: null });
      expect(d.maxSessionSeconds).toBeUndefined();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('FAIL OPEN'));
      expect(alerts.reportAlert).toHaveBeenCalledWith('bot_cap', 'BOT_CAP_LOOKUP_FAILED', expect.anything(), expect.any(Number));
    });
    it('a thrown exception also fails open', async () => {
      h.db = { from: () => { throw new Error('connection reset'); } };
      expect((await cap.checkBotMonthlyCap(U, NOW)).reason).toBe('lookup_failed');
    });
    it('profiles lookup failing for an over-cap user fails open too', async () => {
      db.missing.add('profiles.subscription_expires_at');
      seedRun(500);
      expect((await cap.checkBotMonthlyCap(U, NOW)).reason).toBe('lookup_failed');
    });
    it('a full page of rows (PostgREST row limit) is treated as cap reached, not as zero usage', async () => {
      for (let i = 0; i < cap.USAGE_ROW_LIMIT; i++) db.seed('bot_runs', { user_id: U, status: 'failed', joined_at: iso('2026-11-02T10:00:00Z'), left_at: iso('2026-11-02T10:00:10Z') });
      expect((await cap.checkBotMonthlyCap(U, NOW)).allowed).toBe(false);
    });
  });
});

describe('error shape', () => {
  it('403 BOT_MONTHLY_CAP_REACHED with machine-readable details', () => {
    const e = cap.botCapError({ allowed: false, reason: 'cap_reached', capMinutes: 120, usedMinutes: 125, remainingMinutes: 0, resetsAt: '2026-12-01T00:00:00.000Z' });
    expect(e.statusCode).toBe(403);
    expect(e.code).toBe('BOT_MONTHLY_CAP_REACHED');
    expect(e.details).toEqual({ cap_minutes: '120', used_minutes: '125', remaining_minutes: '0', resets_at: '2026-12-01T00:00:00.000Z' });
    expect(e.message).toContain('2026-12-01');
  });
});

describe('routes', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/meetings', meetingsRouter);
    app.use('/internal/worker', meetingsWorkerRouter);
    app.use(errorHandler);
    await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', r)));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const call = async (method: string, path: string, body?: unknown, user: string | null = U) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
  };
  // Runs are seeded relative to the real clock here (the routes use the real date).
  const seedNowRun = (mins: number) => {
    const joined = new Date(); joined.setUTCDate(1); joined.setUTCHours(0, 0, 1, 0);
    return seedRun(mins, joined.toISOString());
  };
  const JOIN = { join_url: 'https://zoom.us/j/999' };

  it('POST /join over the cap: 403 + code + details, no meeting row, no bot', async () => {
    seedNowRun(121);
    const r = await call('POST', '/api/meetings/join', JOIN);
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('BOT_MONTHLY_CAP_REACHED');
    expect(r.json.error.details).toMatchObject({ cap_minutes: '120', remaining_minutes: '0' });
    expect(r.json.error.details.resets_at).toMatch(/^\d{4}-\d{2}-01T00:00:00.000Z$/);
    expect(createBot).not.toHaveBeenCalled();
    expect(db.rows('meetings')).toHaveLength(0);
  });
  it('POST /join under the cap passes the remaining time to createBot as the session limit', async () => {
    seedNowRun(100);
    const r = await call('POST', '/api/meetings/join', JOIN);
    expect(r.status).toBe(201);
    expect(createBot.mock.calls[0]![1]).toEqual({ maxDurationSeconds: 20 * 60 });
  });
  it('POST /join with a failing usage lookup still starts the bot (fail open)', async () => {
    db.missing.add('bot_runs.joined_at');
    const r = await call('POST', '/api/meetings/join', JOIN);
    expect(r.status).toBe(201);
    expect(createBot.mock.calls[0]![1]).toEqual({});
  });
  it('POST /:id/join-now over the cap: 403, the scheduled bot is not cancelled, no bot', async () => {
    seedNowRun(120);
    const m = db.seed('meetings', { user_id: U, join_url: 'https://zoom.us/j/1', status: 'bot_queued', title: 't' });
    const r = await call('POST', `/api/meetings/${m.id}/join-now`, {});
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('BOT_MONTHLY_CAP_REACHED');
    expect(scheduler.cancelScheduledBot).not.toHaveBeenCalled();
    expect(createBot).not.toHaveBeenCalled();
    expect(m.status).toBe('bot_queued');
  });
  it('scheduled bot-join worker over the cap: meeting marked failed with the reason, job failed, 200 skipped, no bot', async () => {
    seedNowRun(130);
    const m = db.seed('meetings', { user_id: U, join_url: 'https://zoom.us/j/1', status: 'bot_queued', title: 't' });
    const r = await call('POST', '/internal/worker/bot-join', { meetingId: m.id, userId: U }, null);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, skipped: true, reason: 'BOT_MONTHLY_CAP_REACHED' });
    expect(m.status).toBe('failed');
    expect(m.error_message).toMatch(/free meeting-bot minutes/);
    expect(scheduler.markJobFailed).toHaveBeenCalledWith(m.id, 'BOT_MONTHLY_CAP_REACHED');
    expect(createBot).not.toHaveBeenCalled();
    expect(db.rows('bot_runs').filter((x) => !x.joined_at)).toHaveLength(0);
  });
  it('scheduled bot-join worker under the cap starts the bot with a session limit', async () => {
    const m = db.seed('meetings', { user_id: U, join_url: 'https://zoom.us/j/1', status: 'bot_queued', title: 't' });
    const r = await call('POST', '/internal/worker/bot-join', { meetingId: m.id, userId: U }, null);
    expect(r.status).toBe(200);
    expect(createBot.mock.calls[0]![1]).toEqual({ maxDurationSeconds: 120 * 60 });
  });
  it('an allow-listed user can still join over the cap', async () => {
    (config as any).BOT_CAP_EXEMPT_USER_IDS = U;
    seedNowRun(900);
    const r = await call('POST', '/api/meetings/join', JOIN);
    expect(r.status).toBe(201);
    expect(createBot.mock.calls[0]![1]).toEqual({});
  });
});

describe('RecallService.createBot session limit', () => {
  let sent: any[];
  beforeEach(() => {
    sent = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'bot_1', status: 'ready', meeting_url: 'x' }), { status: 200 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('no limit given: automatic_leave is exactly the old default', async () => {
    const { RecallService } = await vi.importActual<typeof import('../src/services/recallService.js')>('../src/services/recallService.js');
    await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1' });
    expect(sent[0].automatic_leave).toEqual({ waiting_room_timeout: 600, noone_joined_timeout: 300, everyone_left_timeout: 30 });
  });
  it('limit given: adds in_call_recording_timeout and keeps the other timeouts', async () => {
    const { RecallService } = await vi.importActual<typeof import('../src/services/recallService.js')>('../src/services/recallService.js');
    await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1' }, { maxDurationSeconds: 1800 });
    expect(sent[0].automatic_leave).toEqual({ waiting_room_timeout: 600, noone_joined_timeout: 300, everyone_left_timeout: 30, in_call_recording_timeout: 1800 });
  });
});
