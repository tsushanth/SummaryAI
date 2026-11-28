/**
 * A coaching session follows its meeting bot. It has nothing to work from when the bot fails or is never admitted, or when
 * nobody speaks. These tests pin what happens then.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { LiveDb } from './helpers-liveDb.js';

const h = vi.hoisted(() => ({
  db: null as any,
  claude: vi.fn(),
  alerts: [] as Array<{ code: string; ctx: Record<string, unknown> }>,
}));
vi.mock('../src/lib/supabase.js', () => ({ get supabaseAdmin() { return h.db; } }));
vi.mock('../src/config/index.js', () => ({ config: {} }));
vi.mock('../src/lib/llm.js', () => ({ instrumentAnthropic: (c: any) => c, withFeature: (_n: string, fn: () => any) => fn() }));
vi.mock('../src/lib/alerts.js', () => ({
  reportAlert: (_flow: string, code: string, ctx: Record<string, unknown> = {}) => { h.alerts.push({ code, ctx }); return true; },
  reportProviderFailure: vi.fn(),
}));
vi.mock('../src/services/googlePlayBilling.js', () => ({ getSubscriptionPurchase: vi.fn(), acknowledgeSubscription: vi.fn() }));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: req.headers['x-user'] ?? 'user-1' }; next(); },
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: (...a: unknown[]) => h.claude(...a) }; } }));

const coaching = await import('../src/services/coachingService.js');
const { deriveBotState, botEndReason } = await import('../src/services/meetingBotState.js');
const { default: routes } = await import('../src/routes/coaching.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const REC = '22222222-2222-4222-8222-222222222222';
let db: LiveDb;
const reply = (...texts: string[]) => ({ content: [{ type: 'text', text: JSON.stringify({ insights: texts.map((text) => ({ type: 'question', text, urgency: 'now' })) }) }] });

function seed(run: Record<string, unknown> = {}) {
  db.seed('coaching_credits', { id: 'credit', user_id: 'user-1', balance: 3, source: 'free' });
  db.seed('recordings', { id: REC, user_id: 'user-1', meeting_id: 'meet-1' });
  return db.seed('bot_runs', { id: 'run-1', meeting_id: 'meet-1', status: 'recording', recall_status: 'in_call_recording', joined_at: new Date().toISOString(), ...run });
}
const say = (text: string, speaker = 'Prospect', at = 40) => db.seed('live_transcripts', { meeting_id: 'meet-1', speaker_name: speaker, segment_text: text, end_timestamp: at, is_partial: false, shadow: false });
/** The user message of the nth model call. */
const asked = (n: number): string => (h.claude.mock.calls[n]![0] as any).messages[0].content;
const balance = () => db.rows('coaching_credits')[0]!.balance;
const session = () => db.rows('coaching_sessions')[0]!;
const start = () => coaching.startSession('user-1', REC, 'sales_discovery');
/** One 30 s cadence. */
const tick = async () => { await vi.advanceTimersByTimeAsync(30_000); await vi.advanceTimersByTimeAsync(0); };
const open: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  db = new LiveDb();
  // The columns the real tables default.
  const from = db.from;
  let emitted = 0;
  db.from = (t: string) => {
    const q = from(t);
    if (t === 'coaching_insights') {
      const insert = q.insert;
      q.insert = (row: any) => insert({ emitted_at: new Date(1_800_000_000_000 + ++emitted * 1000).toISOString(), ...row });
    }
    if (t === 'coaching_sessions') {
      const insert = q.insert;
      q.insert = (row: any) => insert({ ended_at: null, insight_count: 0, refunded: false, refund_reason: null, started_at: new Date().toISOString(), ...row });
    }
    return q;
  };
  h.db = db;
  h.claude.mockReset();
  h.claude.mockResolvedValue(reply());
  h.alerts.length = 0;
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(async () => {
  for (const s of db.rows('coaching_sessions')) await coaching.endSession(s.id);
  open.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('what the bot is doing', () => {
  const state = (run: Record<string, unknown>) => deriveBotState(run as any);
  it('tells waiting, in the meeting, ended and failed apart', () => {
    expect(state({ status: 'joining', recall_status: 'joining_call' }).state).toBe('joining');
    expect(state({ status: 'joining', recall_status: 'in_waiting_room' }).state).toBe('waiting_room');
    expect(state({ status: 'in_call', recall_status: 'in_call_not_recording', joined_at: 'x' }).state).toBe('in_call');
    expect(state({ status: 'recording', recall_status: 'in_call_recording', joined_at: 'x' }).state).toBe('recording');
    expect(state({ status: 'processing', recall_status: 'call_ended', joined_at: 'x' }).state).toBe('ended');
    expect(state({ status: 'completed', recall_status: 'done', joined_at: 'x' }).state).toBe('ended');
    expect(state({ status: 'failed', error_code: 'meeting_password_incorrect' })).toEqual({ state: 'failed', code: 'meeting_password_incorrect', joined: false });
  });
  it('never passes a raw provider message on as a code', () => {
    expect(state({ status: 'failed', error_message: 'Recall API error: 500 - boom' }).code).toBeNull();
    expect(state({ status: 'failed', error_message: 'timeout_exceeded_waiting_room' }).code).toBe('timeout_exceeded_waiting_room');
  });
  it('a bot that is still coming or in the meeting has no end reason', () => {
    for (const status of ['joining', 'in_call', 'recording']) expect(botEndReason(state({ status }))).toBeNull();
    expect(botEndReason(state({ status: 'failed', error_code: 'timeout_exceeded_waiting_room' }))).toBe('bot_not_admitted');
    expect(botEndReason(state({ status: 'failed', error_code: 'bot_kicked_from_waiting_room' }))).toBe('bot_not_admitted');
    expect(botEndReason(state({ status: 'failed', error_code: 'meeting_password_incorrect' }))).toBe('bot_failed');
    expect(botEndReason(state({ status: 'processing', joined_at: 'x' }))).toBe('meeting_ended');
    expect(botEndReason(state({ status: 'processing', joined_at: null }))).toBe('bot_failed');
  });
  it('a bot that failed after getting in (storing the recording, say) did not fail to join', () => {
    const stored = state({ status: 'failed', joined_at: 'x', error_message: 'Recording could not be stored: too large' });
    expect(botEndReason(stored)).toBe('meeting_ended');
    expect(botEndReason(state({ status: 'failed', recall_status: 'in_call_recording', joined_at: null }))).toBe('meeting_ended');
    expect(state({ status: 'failed', recall_status: 'in_call_recording' }).joined).toBe(true);
  });
});

describe('starting a session', () => {
  it('is refused without taking a credit when the bot has already failed', async () => {
    seed({ status: 'failed', recall_status: 'fatal', error_code: 'meeting_password_incorrect', joined_at: null });
    await expect(start()).rejects.toMatchObject({ code: 'meeting_password_incorrect', endReason: 'bot_failed' });
    expect(balance()).toBe(3);
    expect(db.rows('coaching_sessions')).toHaveLength(0);
  });
  it('twice for the same recording gives the same session and takes one credit', async () => {
    seed();
    const first = await start();
    const second = await start();
    expect(second).toEqual({ sessionId: first.sessionId, resumed: true });
    expect(balance()).toBe(2);
    expect(db.rows('coaching_sessions')).toHaveLength(1);
  });
});

describe('the ticker follows the bot', () => {
  it('ends the session, refunds and records why when the bot is never admitted', async () => {
    const run = seed({ status: 'joining', recall_status: 'in_waiting_room', joined_at: null });
    const { sessionId } = await start();
    const events: Array<[string, any]> = [];
    coaching.subscribe(sessionId, (e, d) => events.push([e, d]));
    await tick();
    expect(session().ended_at).toBeNull(); // still waiting: nothing to end
    Object.assign(run, { status: 'failed', error_code: 'timeout_exceeded_waiting_room' });
    await tick();
    expect(session().ended_at).not.toBeNull();
    expect(session().refund_reason).toBe('insight_count_below_threshold:bot_not_admitted');
    expect(balance()).toBe(3);
    expect(events).toEqual([['ended', { reason: 'bot_not_admitted', refunded: true }]]);
    expect(h.claude).not.toHaveBeenCalled();
    expect(h.alerts.map((a) => a.code)).toContain('NO_INSIGHTS_BOT_NOT_ADMITTED');
  });
  it('is closed at once by the webhook path, only once the bot is gone', async () => {
    const run = seed();
    await start();
    await coaching.endSessionsIfBotGone('meet-1');
    expect(session().ended_at).toBeNull();
    Object.assign(run, { status: 'processing', recall_status: 'call_ended' });
    await coaching.endSessionsIfBotGone('meet-1');
    expect(session().ended_at).not.toBeNull();
  });
  it('asks the model only when something new was said', async () => {
    seed();
    await start();
    say('We need this live before January');
    await tick();
    await tick();
    await tick();
    expect(h.claude).toHaveBeenCalledTimes(1);
    say('My director signs off on the budget');
    await tick();
    expect(h.claude).toHaveBeenCalledTimes(2);
  });
  it('tries again on the next tick after a failed call or an unreadable reply', async () => {
    seed();
    await start();
    say('We are also looking at two other vendors');
    h.claude.mockRejectedValueOnce(new Error('overloaded'));
    await tick();
    h.claude.mockResolvedValueOnce({ content: [{ type: 'text', text: 'sorry, no JSON here' }] });
    await tick();
    h.claude.mockResolvedValueOnce(reply('Who else is deciding?'));
    await tick();
    expect(h.claude).toHaveBeenCalledTimes(3);
    expect(db.rows('coaching_insights')).toHaveLength(1);
    expect(h.alerts.map((a) => a.code)).toEqual(expect.arrayContaining(['TICK_FAILED', 'PARSE_FAILED']));
  });
  it('does not start a second call while one is still running', async () => {
    seed();
    await start();
    say('Our current tool is a spreadsheet');
    let finish!: (v: unknown) => void;
    h.claude.mockReturnValueOnce(new Promise((r) => { finish = r; }));
    await tick();
    say('and it breaks every week');
    await tick();
    expect(h.claude).toHaveBeenCalledTimes(1);
    finish(reply());
    await tick();
    expect(h.claude).toHaveBeenCalledTimes(2);
  });
  it('drops tips that arrive after the session has ended', async () => {
    seed();
    const { sessionId } = await start();
    say('Budget is approved');
    let finish!: (v: unknown) => void;
    h.claude.mockReturnValueOnce(new Promise((r) => { finish = r; }));
    await tick();
    await coaching.endSession(sessionId);
    finish(reply('Too late'));
    await vi.advanceTimersByTimeAsync(0);
    expect(db.rows('coaching_insights')).toHaveLength(0);
  });
});

describe('ending while tips are being delivered', () => {
  const five = () => reply('One', 'Two', 'Three', 'Four', 'Five');

  it('never refunds a session that has delivered three tips', async () => {
    seed();
    const { sessionId } = await start();
    say('We need this live before January');
    h.claude.mockResolvedValue(five());
    let delivered = 0;
    let ended: Promise<{ refunded: boolean }> | undefined;
    coaching.subscribe(sessionId, (event) => { if (event === 'insight' && ++delivered === 3) ended = coaching.endSession(sessionId); });
    await tick();
    say('Our budget is five hundred a month');
    await tick();
    expect((await ended!).refunded).toBe(false);
    expect(balance()).toBe(2);
    expect(session().insight_count).toBeGreaterThanOrEqual(3);
    expect(db.rows('coaching_insights')).toHaveLength(session().insight_count);
  });

  it('keeps no tip it could not count: what is stored is what the refund was decided on', async () => {
    seed();
    const { sessionId } = await start();
    say('We need this live before January');
    h.claude.mockResolvedValue(five());
    // The session is ended between the third tip being stored and being counted.
    const from = db.from;
    let inserts = 0;
    let ended: Promise<{ refunded: boolean }> | undefined;
    db.from = (t: string) => {
      const q = from(t);
      if (t === 'coaching_insights') {
        const insert = q.insert;
        q.insert = (row: any) => { if (++inserts === 3) ended = coaching.endSession(sessionId); return insert(row); };
      }
      return q;
    };
    await tick();
    say('Our budget is five hundred a month');
    await tick();
    expect((await ended!).refunded).toBe(true);
    expect(session().insight_count).toBe(2);
    expect(db.rows('coaching_insights').map((i) => i.text)).toEqual(['One', 'Two']);
  });
});

describe('closing a session the database does not accept', () => {
  const down = () => db.failing.set('coaching_sessions.update', { code: '57014', message: 'statement timeout' });
  const up = () => db.failing.delete('coaching_sessions.update');

  it('is an error, not a success, and a repeat closes and refunds it', async () => {
    seed();
    const { sessionId } = await start();
    const events: string[] = [];
    coaching.subscribe(sessionId, (e) => events.push(e));
    down();
    await expect(coaching.endSession(sessionId)).rejects.toThrow('could not end coaching session');
    expect(session().ended_at).toBeNull();
    expect(balance()).toBe(2);
    expect(events).toEqual([]);
    expect(h.alerts.map((a) => a.code)).toContain('END_FAILED');
    up();
    expect(await coaching.endSession(sessionId)).toEqual({ refunded: true });
    expect(balance()).toBe(3);
  });
  it('asks the model nothing more once the user has said stop', async () => {
    seed();
    const { sessionId } = await start();
    down();
    await coaching.endSession(sessionId, 'client').catch(() => undefined);
    say('and one more thing');
    await tick();
    expect(h.claude).not.toHaveBeenCalled();
    up();
  });
  it('is tried again by the ticker when the bot has gone', async () => {
    const run = seed();
    await start();
    Object.assign(run, { status: 'processing', recall_status: 'call_ended' });
    down();
    await tick();
    expect(session().ended_at).toBeNull();
    up();
    await tick();
    expect(session().ended_at).not.toBeNull();
    expect(balance()).toBe(3);
  });
  it('does not take the credit question for an answer when it cannot be read', async () => {
    seed();
    db.failing.set('coaching_credits.select', { message: 'fetch failed' });
    const failure = await start().then(() => null, (e) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(coaching.NoCreditsError);
    expect(db.rows('coaching_sessions')).toHaveLength(0);
  });
});

describe('what the model is asked, and how much of its answer is used', () => {
  it('gets one sentence per speaker turn, not the pieces speech recognition delivered', async () => {
    seed();
    await start();
    for (const piece of ['we plan to', 'roll out', 'in', 'march']) say(piece);
    say('understood', 'Seller');
    await tick();
    expect(asked(0)).toContain('[Prospect]: we plan to roll out in march\n[Seller]: understood');
    expect(asked(0)).not.toContain('New since you last looked');
  });
  it('is shown what is new since it last looked, with the whole sentence above', async () => {
    seed();
    await start();
    say('the part that slows us down');
    await tick();
    say('is onboarding');
    await tick();
    expect(asked(1)).toContain('[Prospect]: the part that slows us down is onboarding');
    expect(asked(1)).toContain('New since you last looked (also included above):\n[Prospect]: is onboarding\n');
  });
  it('holds a line that stops mid-sentence until the rest arrives', async () => {
    seed();
    await start();
    say('we need a shared calendar');
    say('the most we can spend is about');
    await tick();
    expect(asked(0)).toContain('we need a shared calendar');
    expect(asked(0)).not.toContain('spend');
    say('two thousand a year');
    await tick();
    expect(asked(1)).toContain('the most we can spend is about two thousand a year');
  });
  it('holds it for one tick only, when nothing more is said', async () => {
    seed();
    await start();
    say('the last vendor we met with');
    await tick();
    expect(h.claude).not.toHaveBeenCalled();
    await tick();
    expect(asked(0)).toContain('the last vendor we met with');
    await tick();
    expect(h.claude).toHaveBeenCalledTimes(1);
  });
  it('times a tip by the newest line it was given', async () => {
    seed();
    await start();
    say('first thing said', 'Prospect', 12);
    say('latest thing said', 'Prospect', 95);
    h.claude.mockResolvedValue(reply('Ask about budget'));
    await tick();
    expect(db.rows('coaching_insights')[0]!.transcript_offset_seconds).toBe(95);
  });
  it('delivers at most two tips a tick', async () => {
    seed();
    await start();
    say('We need this live before January');
    h.claude.mockResolvedValue(reply('One', 'Two', 'Three', 'Four'));
    await tick();
    expect(db.rows('coaching_insights').map((i) => i.text)).toEqual(['One', 'Two']);
    expect(session().insight_count).toBe(2);
  });
  it('is given every earlier tip of the call, oldest first', async () => {
    seed();
    await start();
    for (let n = 1; n <= 11; n++) {
      say(`point number ${n}`);
      h.claude.mockResolvedValue(reply(`tip ${n}a`, `tip ${n}b`));
      await tick();
    }
    const last = asked(10);
    expect(last.indexOf('- tip 1a')).toBeGreaterThan(-1);
    expect(last.indexOf('- tip 1a')).toBeLessThan(last.indexOf('- tip 10b'));
  });
});

describe('why a session produced nothing', () => {
  const reason = async () => { await coaching.endSession(session().id, 'client'); return session().refund_reason; };
  it('nobody spoke', async () => { seed(); await start(); await tick(); expect(await reason()).toBe('insight_count_below_threshold:no_speech'); });
  it('left before the bot got in', async () => { seed({ status: 'joining', recall_status: 'in_waiting_room', joined_at: null }); await start(); expect(await reason()).toBe('insight_count_below_threshold:bot_not_in_meeting'); });
  it('ended before the first tick', async () => { seed(); await start(); say('hello there'); expect(await reason()).toBe('insight_count_below_threshold:ended_too_soon'); });
  it('the model had nothing to suggest', async () => { seed(); await start(); say('hello there'); await tick(); expect(await reason()).toBe('insight_count_below_threshold:no_suggestions'); });
  it('the model call failed', async () => { seed(); await start(); say('hello there'); h.claude.mockRejectedValue(new Error('401')); await tick(); expect(await reason()).toBe('insight_count_below_threshold:model_failed'); });
  it('one or two tips keeps the plain reason', async () => {
    seed(); await start(); say('hello there'); h.claude.mockResolvedValue(reply('Ask about budget')); await tick();
    expect(await reason()).toBe('insight_count_below_threshold');
  });
});

describe('routes', () => {
  let server: Server;
  let base: string;
  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/coaching', routes);
    app.use(errorHandler);
    await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', r)));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/coaching`;
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); });
  const post = (path: string, body?: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

  const unreachable = { message: 'TypeError: fetch failed' };
  const requests = (sessionId: string) => [
    ['start', 'recordings.select', () => post('/sessions', { recording_id: REC, persona: 'sales_discovery' })],
    ['latest session', 'recordings.select', () => fetch(`${base}/recordings/${REC}/session`)],
    ['latest session, session', 'coaching_sessions.select', () => fetch(`${base}/recordings/${REC}/session`)],
    ['latest session, tips', 'coaching_insights.select', () => fetch(`${base}/recordings/${REC}/session`)],
    ['stream', 'coaching_sessions.select', () => fetch(`${base}/sessions/${sessionId}/stream`)],
    ['end', 'coaching_sessions.select', () => post(`/sessions/${sessionId}/end`)],
    ['end, closing', 'coaching_sessions.update', () => post(`/sessions/${sessionId}/end`)],
    ['insights', 'coaching_sessions.select', () => fetch(`${base}/sessions/${sessionId}/insights`)],
    ['insights, tips', 'coaching_insights.select', () => fetch(`${base}/sessions/${sessionId}/insights`)],
  ] as const;

  it('answers 500, so the client tries again, when the database cannot be read or written', async () => {
    seed();
    const { sessionId } = await start();
    for (const [name, key, request] of requests(sessionId)) {
      db.failing.set(key, unreachable);
      expect([name, (await request()).status]).toEqual([name, 500]);
      db.failing.clear();
    }
    expect(session().ended_at).toBeNull();
    expect((await post(`/sessions/${sessionId}/end`)).status).toBe(200);
  });
  it('keeps 404 for what is really not there, including an id that is no id', async () => {
    seed();
    expect((await post('/sessions/none/end')).status).toBe(404);
    expect((await fetch(`${base}/sessions/none/insights`)).status).toBe(404);
    expect((await fetch(`${base}/sessions/none/stream`)).status).toBe(404);
    db.failing.set('coaching_sessions.select', { code: '22P02', message: 'invalid input syntax for type uuid' });
    expect((await post('/sessions/not-a-uuid/end')).status).toBe(404);
    db.failing.set('recordings.select', { code: '22P02', message: 'invalid input syntax for type uuid' });
    expect((await fetch(`${base}/recordings/not-a-uuid/session`)).status).toBe(404);
  });
  it('closes a stream whose earlier tips cannot be read, so the client reconnects', async () => {
    seed();
    const { sessionId } = await start();
    db.failing.set('coaching_insights.select', unreachable);
    const res = await fetch(`${base}/sessions/${sessionId}/stream`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(''); // resolves only if the server closes it
  });
  it('answers 409 with the reason for a bot that already failed', async () => {
    seed({ status: 'failed', recall_status: 'fatal', error_code: 'meeting_not_found', joined_at: null });
    const r = await post('/sessions', { recording_id: REC, persona: 'sales_discovery' });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'meeting_not_live', reason: 'meeting_not_found', end_reason: 'bot_failed' });
  });
  it('hands a reopened app the latest session of its own recording, with the tips', async () => {
    seed();
    expect(await (await fetch(`${base}/recordings/${REC}/session`)).json()).toEqual({ session: null, insights: [] });
    const { sessionId } = await start();
    say('hello there');
    h.claude.mockResolvedValue(reply('Ask about budget'));
    await tick();
    const body = await (await fetch(`${base}/recordings/${REC}/session`)).json();
    expect(body.session).toMatchObject({ id: sessionId, ended_at: null, insight_count: 1, end_reason: null });
    expect(body.insights.map((i: any) => i.text)).toEqual(['Ask about budget']);
    await coaching.endSession(sessionId, 'bot_failed');
    // A session that produced something has no "why nothing" reason.
    expect((await (await fetch(`${base}/recordings/${REC}/session`)).json()).session).toMatchObject({ refunded: true, end_reason: null });
    expect((await fetch(`${base}/recordings/${REC}/session`, { headers: { 'x-user': 'someone-else' } })).status).toBe(404);
  });
  it('sends each tip once, says why the session ended and closes the stream', async () => {
    seed();
    const { sessionId } = await start();
    say('hello there');
    h.claude.mockResolvedValue(reply('First'));
    await tick();
    const res = await fetch(`${base}/sessions/${sessionId}/stream`);
    const reader = res.body!.getReader();
    let text = '';
    const drain = (async () => { for (;;) { const { value, done } = await reader.read(); if (done) return; text += Buffer.from(value).toString(); } })();
    await vi.waitFor(() => expect(text).toContain('First'));
    say('and another thing');
    h.claude.mockResolvedValue(reply('Second'));
    await tick();
    await vi.waitFor(() => expect(text).toContain('Second'));
    await coaching.endSession(sessionId, 'meeting_ended');
    await drain; // resolves only if the server closes the stream
    expect(text.match(/event: insight/g)).toHaveLength(2);
    expect(text).toContain('event: ended\ndata: {"reason":"meeting_ended","refunded":true}');
  });
});
