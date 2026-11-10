import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { FakeDb } from './helpers-fakeDb.js';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/lib/supabase.js', () => ({ get supabaseAdmin() { return h.db; } }));
vi.mock('../src/lib/failureReporter.js', () => ({ reportBackendError: vi.fn() }));
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
const notify = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/liveSttControl.js', () => ({ notifyLiveLanguage: notify }));

const { default: meetingsRouter, meetingsWorkerRouter } = await import('../src/routes/meetings.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

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

const U = '11111111-1111-4111-8111-111111111111';
const call = async (method: string, path: string, body?: unknown, user: string | null = U) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
};

let db: FakeDb;
beforeEach(() => {
  db = new FakeDb();
  h.db = db;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  createBot.mockReset();
  createBot.mockImplementation(async () => ({ id: 'bot-1', status: 'ready', meeting_url: 'x' }));
  notify.mockReset();
  scheduler.scheduleBotJoin.mockClear();
  db.seed('profiles', { id: U, preferences: {} });
});

const NEW_MEETING = { title: 'Standup', join_url: 'https://zoom.us/j/123', scheduled_start: '2030-01-01T10:00:00.000Z', auto_join: false };

describe('POST /api/meetings (manual meeting)', () => {
  it('stores nothing extra when no language is given (insert row unchanged: it will follow the owner default)', async () => {
    const r = await call('POST', '/api/meetings', NEW_MEETING);
    expect(r.status).toBe(201);
    expect(db.rows('meetings')[0]).not.toHaveProperty('transcription_language');
  });
  it("an explicit 'auto' is stored as 'auto' so it beats a later change of the owner default", async () => {
    await call('POST', '/api/meetings', { ...NEW_MEETING, transcription_language: 'auto' });
    expect(db.rows('meetings')[0].transcription_language).toBe('auto');
  });
  it('stores the normalized language', async () => {
    const r = await call('POST', '/api/meetings', { ...NEW_MEETING, transcription_language: 'FR-ca' });
    expect(r.status).toBe(201);
    expect(db.rows('meetings')[0].transcription_language).toBe('fr');
  });
  it('rejects unknown codes with 400 and writes nothing', async () => {
    for (const bad of ['klingon', 'ar', 5, '']) {
      const r = await call('POST', '/api/meetings', { ...NEW_MEETING, transcription_language: bad });
      expect(r.status).toBe(400);
    }
    expect(db.rows('meetings')).toHaveLength(0);
  });
  it('before migration 027: still creates the meeting and says the language was not saved', async () => {
    db.missing.add('meetings.transcription_language');
    const r = await call('POST', '/api/meetings', { ...NEW_MEETING, transcription_language: 'es' });
    expect(r.status).toBe(201);
    expect(db.rows('meetings')).toHaveLength(1);
    expect(r.json.warning).toMatch(/language/i);
  });
});

describe('POST /api/meetings/join (instant join)', () => {
  const JOIN = { join_url: 'https://zoom.us/j/999' };
  it('no language and no user default -> createBot gets auto; bot_runs row has no language column', async () => {
    const r = await call('POST', '/api/meetings/join', JOIN);
    expect(r.status).toBe(201);
    expect(createBot.mock.calls[0]![0]).toMatchObject({ meeting_url: JOIN.join_url, transcription_language: 'auto' });
    expect(db.rows('bot_runs')[0]).not.toHaveProperty('transcription_language');
    expect(db.rows('meetings')[0]).not.toHaveProperty('transcription_language');
  });
  it('explicit language goes to Recall and is stored on the meeting and the bot run', async () => {
    const r = await call('POST', '/api/meetings/join', { ...JOIN, transcription_language: 'es' });
    expect(r.status).toBe(201);
    expect(createBot.mock.calls[0]![0].transcription_language).toBe('es');
    expect(db.rows('bot_runs')[0].transcription_language).toBe('es');
    expect(db.rows('meetings')[0].transcription_language).toBe('es');
  });
  it("falls back to the user's saved default language", async () => {
    db.rows('profiles')[0].preferences = { default_transcription_language: 'de' };
    await call('POST', '/api/meetings/join', JOIN);
    expect(createBot.mock.calls[0]![0].transcription_language).toBe('de');
    expect(db.rows('bot_runs')[0].transcription_language).toBe('de');
  });
  it('an explicit auto beats the saved default', async () => {
    db.rows('profiles')[0].preferences = { default_transcription_language: 'de' };
    await call('POST', '/api/meetings/join', { ...JOIN, transcription_language: 'auto' });
    expect(createBot.mock.calls[0]![0].transcription_language).toBe('auto');
    expect(db.rows('bot_runs')[0]).not.toHaveProperty('transcription_language');
  });
  it('rejects an unknown language before any bot is created', async () => {
    const r = await call('POST', '/api/meetings/join', { ...JOIN, transcription_language: 'xx' });
    expect(r.status).toBe(400);
    expect(createBot).not.toHaveBeenCalled();
  });
  it('before migration 027 the bot_runs and meetings rows are still written', async () => {
    db.missing.add('bot_runs.transcription_language');
    db.missing.add('meetings.transcription_language');
    const r = await call('POST', '/api/meetings/join', { ...JOIN, transcription_language: 'fr' });
    expect(r.status).toBe(201);
    expect(db.rows('bot_runs')).toHaveLength(1);
    expect(db.rows('bot_runs')[0].recall_bot_id).toBe('bot-1');
    expect(db.rows('meetings')).toHaveLength(1);
  });
});

describe('POST /api/meetings/:id/join-now and the scheduled bot-join worker', () => {
  it('join-now uses the meeting language, a body override wins', async () => {
    const m = db.seed('meetings', { user_id: U, join_url: 'https://zoom.us/j/1', status: 'scheduled', transcription_language: 'it', title: 't' });
    expect((await call('POST', `/api/meetings/${m.id}/join-now`, {})).status).toBe(200);
    expect(createBot.mock.calls[0]![0].transcription_language).toBe('it');
    expect(db.rows('bot_runs')[0].transcription_language).toBe('it');
    db.tables.bot_runs = []; m.status = 'scheduled';
    await call('POST', `/api/meetings/${m.id}/join-now`, { transcription_language: 'ja' });
    expect(createBot.mock.calls[1]![0].transcription_language).toBe('ja');
  });
  it('bot-join worker (scheduled/calendar meetings) uses the meeting language, else the owner default, else auto', async () => {
    const a = db.seed('meetings', { user_id: U, join_url: 'https://zoom.us/j/1', status: 'bot_queued', transcription_language: 'pt', title: 't' });
    const r = await call('POST', '/internal/worker/bot-join', { meetingId: a.id, userId: U }, null);
    expect(r.status).toBe(200);
    expect(createBot.mock.calls[0]![0].transcription_language).toBe('pt');
    expect(db.rows('bot_runs')[0].transcription_language).toBe('pt');

    const b = db.seed('meetings', { user_id: U, join_url: 'https://zoom.us/j/2', status: 'bot_queued', title: 't2' });
    db.rows('profiles')[0].preferences = { default_transcription_language: 'ko' };
    await call('POST', '/internal/worker/bot-join', { meetingId: b.id, userId: U }, null);
    expect(createBot.mock.calls[1]![0].transcription_language).toBe('ko');

    const c = db.seed('meetings', { user_id: U, join_url: 'https://zoom.us/j/3', status: 'bot_queued', title: 't3' });
    db.rows('profiles')[0].preferences = {};
    await call('POST', '/internal/worker/bot-join', { meetingId: c.id, userId: U }, null);
    expect(createBot.mock.calls[2]![0].transcription_language).toBe('auto');
  });
});

describe('PATCH /api/meetings/:id', () => {
  it("changes the language of a not-yet-joined meeting; 'auto' is stored explicitly", async () => {
    const m = db.seed('meetings', { user_id: U, join_url: 'u', status: 'scheduled', auto_join: false, title: 't', transcription_language: 'fr' });
    expect((await call('PATCH', `/api/meetings/${m.id}`, { transcription_language: 'es' })).status).toBe(200);
    expect(m.transcription_language).toBe('es');
    await call('PATCH', `/api/meetings/${m.id}`, { transcription_language: 'auto' });
    expect(m.transcription_language).toBe('auto');
    expect((await call('PATCH', `/api/meetings/${m.id}`, { transcription_language: 'zz' })).status).toBe(400);
  });
});

describe('GET /api/meetings/transcription-languages and the saved default', () => {
  it('lists the allow-list with native names, the default and the live-provider facts', async () => {
    const r = await call('GET', '/api/meetings/transcription-languages');
    expect(r.status).toBe(200);
    expect(r.json.default_language).toBe('auto');
    expect(r.json.languages).toHaveLength(35);
    expect(r.json.languages.find((l: any) => l.code === 'ja')).toEqual({ code: 'ja', name: 'Japanese', native: '日本語' });
    expect(r.json.live).toMatchObject({ provider: 'recall', can_change_during_meeting: false, non_english_live_delay_minutes: '3-10' });
  });
  it('PUT saves the default into profile preferences without touching other preferences; auto removes it', async () => {
    db.rows('profiles')[0].preferences = { default_summary_template: 'brief' };
    const r = await call('PUT', '/api/meetings/transcription-languages/default', { language: 'FR' });
    expect(r.json).toEqual({ default_language: 'fr' });
    expect(db.rows('profiles')[0].preferences).toEqual({ default_summary_template: 'brief', default_transcription_language: 'fr' });
    expect((await call('GET', '/api/meetings/transcription-languages')).json.default_language).toBe('fr');
    await call('PUT', '/api/meetings/transcription-languages/default', { language: 'auto' });
    expect(db.rows('profiles')[0].preferences).toEqual({ default_summary_template: 'brief' });
    expect((await call('PUT', '/api/meetings/transcription-languages/default', { language: 'nope' })).status).toBe(400);
  });
  it('requires auth', async () => {
    expect((await call('GET', '/api/meetings/transcription-languages', undefined, null)).status).toBe(401);
  });
});

describe('POST /api/meetings/:id/live-language', () => {
  const live = (over: Record<string, unknown> = {}) => {
    const m = db.seed('meetings', { user_id: U, join_url: 'u', status: 'bot_in_meeting', title: 't', transcription_language: null });
    const run = db.seed('bot_runs', { meeting_id: m.id, user_id: U, status: 'in_call', live_stt_provider: 'soniox', live_stt_ref: 'ref-abc-123456', transcription_language: null, ...over });
    return { m, run };
  };

  it('validates the language (400) and requires auth (401)', async () => {
    const { m } = live();
    expect((await call('POST', `/api/meetings/${m.id}/live-language`, { language: 'xx' })).status).toBe(400);
    expect((await call('POST', `/api/meetings/${m.id}/live-language`, {})).status).toBe(400);
    expect((await call('POST', `/api/meetings/${m.id}/live-language`, { language: 'fr' }, null)).status).toBe(401);
    expect(notify).not.toHaveBeenCalled();
  });
  it("404s for someone else's meeting without touching anything", async () => {
    const { m } = live();
    const r = await call('POST', `/api/meetings/${m.id}/live-language`, { language: 'fr' }, 'user-2');
    expect(r.status).toBe(404);
    expect(notify).not.toHaveBeenCalled();
  });
  it('409 MEETING_NOT_LIVE when no bot is in the call', async () => {
    const { m } = live({ status: 'completed' });
    const r = await call('POST', `/api/meetings/${m.id}/live-language`, { language: 'fr' });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('MEETING_NOT_LIVE');
  });
  it('Recall transcript path (provider recall or shadow): 409 LIVE_LANGUAGE_FIXED with a clear message, nothing changed', async () => {
    for (const provider of [null, 'recall', 'shadow']) {
      db.tables.meetings = []; db.tables.bot_runs = [];
      const { m, run } = live({ live_stt_provider: provider });
      const r = await call('POST', `/api/meetings/${m.id}/live-language`, { language: 'fr' });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe('LIVE_LANGUAGE_FIXED');
      expect(r.json.error.message).toMatch(/cannot be changed during a meeting/i);
      expect(run.transcription_language).toBeNull();
    }
    expect(notify).not.toHaveBeenCalled();
  });
  it('soniox path: saves on the run and the meeting, then tells the live service', async () => {
    notify.mockResolvedValue({ ok: true, state: 'applied' });
    const { m, run } = live();
    const r = await call('POST', `/api/meetings/${m.id}/live-language`, { language: 'ES-mx' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, language: 'es', live_applied: true });
    expect(notify).toHaveBeenCalledWith('ref-abc-123456', 'es');
    expect(run.transcription_language).toBe('es');
    expect(m.transcription_language).toBe('es');
  });
  it("'auto' clears the hints (run stored as NULL, meeting as 'auto', service told 'auto')", async () => {
    notify.mockResolvedValue({ ok: true, state: 'applied' });
    const { m, run } = live({ transcription_language: 'es' });
    const r = await call('POST', `/api/meetings/${m.id}/live-language`, { language: 'auto' });
    expect(r.json.language).toBe('auto');
    expect(run.transcription_language).toBeNull();
    expect(m.transcription_language).toBe('auto');
    expect(notify).toHaveBeenCalledWith('ref-abc-123456', 'auto');
  });
  it('queued (session has no audio yet) counts as applied', async () => {
    notify.mockResolvedValue({ ok: true, state: 'queued' });
    const { m } = live();
    const r = await call('POST', `/api/meetings/${m.id}/live-language`, { language: 'de' });
    expect(r.json).toMatchObject({ live_applied: true, live_state: 'queued' });
  });
  it('live service unreachable: 200 with live_applied=false and an honest message (the choice is still saved for the final transcript)', async () => {
    notify.mockResolvedValue({ ok: false, reason: 'unreachable' });
    const { m, run } = live();
    const r = await call('POST', `/api/meetings/${m.id}/live-language`, { language: 'de' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, language: 'de', live_applied: false });
    expect(r.json.message).toMatch(/final transcript/i);
    expect(run.transcription_language).toBe('de');
  });
  it('before migration 027 the live switch still happens', async () => {
    db.missing.add('bot_runs.transcription_language');
    db.missing.add('meetings.transcription_language');
    notify.mockResolvedValue({ ok: true, state: 'applied' });
    const { m } = live();
    const r = await call('POST', `/api/meetings/${m.id}/live-language`, { language: 'fr' });
    expect(r.status).toBe(200);
    expect(r.json.live_applied).toBe(true);
    expect(notify).toHaveBeenCalledWith('ref-abc-123456', 'fr');
  });
});

describe('GET /api/meetings/:id exposes the language state', () => {
  it('soniox run in the call: can_change true', async () => {
    const m = db.seed('meetings', { user_id: U, join_url: 'u', status: 'bot_in_meeting', title: 't', platform: 'zoom', source: 'manual', transcription_language: 'fr' });
    db.seed('bot_runs', { meeting_id: m.id, user_id: U, status: 'in_call', live_stt_provider: 'soniox', transcription_language: 'fr' });
    const r = await call('GET', `/api/meetings/${m.id}`);
    expect(r.status).toBe(200);
    expect(r.json.transcription_language).toBe('fr');
    expect(r.json.live_language).toEqual({ language: 'fr', can_change: true, reason: null, provider: 'soniox' });
    expect(r.json.bot_run).toMatchObject({ status: 'in_call' });
  });
  it('recall run: can_change false / provider_fixed; finished meeting: not_live', async () => {
    const m = db.seed('meetings', { user_id: U, join_url: 'u', status: 'bot_in_meeting', title: 't', platform: 'zoom', source: 'manual' });
    const run = db.seed('bot_runs', { meeting_id: m.id, user_id: U, status: 'in_call' });
    let r = await call('GET', `/api/meetings/${m.id}`);
    expect(r.json.transcription_language).toBe('auto');
    expect(r.json.live_language).toEqual({ language: 'auto', can_change: false, reason: 'provider_fixed', provider: 'recall' });
    run.status = 'completed';
    r = await call('GET', `/api/meetings/${m.id}`);
    expect(r.json.live_language.reason).toBe('not_live');
  });
  it('works before migration 027 (columns missing) exactly as before', async () => {
    db.missing.add('bot_runs.transcription_language');
    db.missing.add('meetings.transcription_language');
    const m = db.seed('meetings', { user_id: U, join_url: 'u', status: 'bot_in_meeting', title: 't', platform: 'zoom', source: 'manual' });
    db.seed('bot_runs', { meeting_id: m.id, user_id: U, status: 'in_call', live_stt_provider: 'soniox' });
    const r = await call('GET', `/api/meetings/${m.id}`);
    expect(r.status).toBe(200);
    expect(r.json.live_language).toMatchObject({ language: 'auto', can_change: true, provider: 'soniox' });
  });
});
