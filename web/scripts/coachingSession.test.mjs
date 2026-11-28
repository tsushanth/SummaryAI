// The AI Coach store and its wording. The cases follow Android's ActiveCoachingSessionTest. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachSession, STOPPED_BY_USER } from '../src/lib/coaching/session.ts';
import { coachingStatusText, coachingCreditText, sessionsLeftText, tipOffsetText } from '../src/lib/coaching/messages.ts';

const MEET = 'meet-1';
const tip = (id) => ({
  id, session_id: 's1', type: 'question', text: `tip ${id}`, urgency: 'now',
  transcript_offset_seconds: null, emitted_at: `2026-01-01T00:00:0${id.at(-1)}`,
});
const refusal = (status, body = null) => Object.assign(new Error(`status ${status}`), { status, body });
const latest = (session, insights = []) => ({
  session: session && { ended_at: null, refunded: false, end_reason: null, ...session },
  insights,
});
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** A live tips stream the test writes into. */
function liveStream() {
  let finish;
  let emit;
  let backlog = [];
  const done = new Promise((resolve, reject) => (finish = { resolve, reject }));
  const stream = {
    aborted: false,
    send(event) { if (emit) emit(event); else backlog.push(event); },
    tip: (id) => stream.send({ type: 'tip', insight: tip(id) }),
    end: (reason, refunded) => stream.send({ type: 'ended', reason, refunded }),
    drop: () => finish.resolve(),
    open(onEvent, signal) {
      emit = onEvent;
      signal.addEventListener('abort', () => { stream.aborted = true; finish.reject(refusal(0)); });
      onEvent({ type: 'connected' });
      backlog.forEach(onEvent);
      backlog = [];
      return done;
    },
  };
  return stream;
}

function setup(options = {}, prepare = () => {}) {
  const api = {
    starts: [],   // { sessionId } or an Error, in order
    streams: [],  // liveStream() or an Error, in order
    latest: latest(null),
    latestFailures: [],
    startCalls: 0,
    streamCalls: 0,
    latestCalls: 0,
    endCalls: 0,
    endFailures: [],
    endRefunded: true,
    ended: [],
    async startSession() {
      api.startCalls++;
      const next = api.starts.shift() ?? { sessionId: 's1' };
      if (next instanceof Error) throw next;
      return next;
    },
    async endSession(id) {
      api.endCalls++;
      const failure = api.endFailures.shift();
      if (failure) throw failure;
      api.ended.push(id);
      await null;
      return { refunded: api.endRefunded };
    },
    async latestSession() {
      api.latestCalls++;
      const failure = api.latestFailures.shift();
      if (failure) throw failure;
      return api.latest;
    },
    streamSession(id, onEvent, signal) {
      api.streamCalls++;
      const next = api.streams.shift() ?? refusal(0);
      return next instanceof Error ? Promise.reject(next) : next.open(onEvent, signal);
    },
  };
  prepare(api); // before the store exists: it may send saved stops at once
  const failures = [];
  const coach = createCoachSession(api, { startRetryMs: [5, 5], reconnectMs: [5, 5], onFailure: (...f) => failures.push(f), ...options });
  const add = () => { const s = liveStream(); api.streams.push(s); return s; };
  const start = () => coach.start(MEET, 'rec-1', 'sales_discovery');
  const until = async (what, meeting = MEET) => {
    for (let i = 0; i < 400; i++) {
      const s = coach.getState(meeting);
      if (what(s)) return s;
      await wait(5);
    }
    assert.fail(`never reached: ${what} (is ${JSON.stringify(coach.getState(meeting))})`);
  };
  return { api, coach, add, start, until, failures };
}

/** Every test ends with reset(), so no reconnect timer outlives it. */
function scenario(name, body) {
  test(name, async () => {
    const t = setup();
    try {
      await body(t);
    } finally {
      t.coach.reset();
    }
  });
}

const ids = (state) => state.insights.map((i) => i.id);

scenario('tips arrive once, newest first, and the server ends the session', async ({ api, add, start, until }) => {
  const stream = add();
  start();
  await until((s) => s?.phase === 'live');
  stream.tip('t1'); stream.tip('t1'); stream.tip('t2');
  assert.deepEqual(ids(await until((s) => s.insights.length === 2)), ['t2', 't1']);
  stream.end('bot_not_admitted', true);
  stream.drop();
  const end = await until((s) => s.phase === 'ended');
  assert.equal(end.endReason, 'bot_not_admitted');
  assert.equal(end.refunded, true);
  assert.equal(end.insights.length, 2);
  await wait();
  assert.equal(api.ended.length, 0, 'nothing but the server or the user ends a session');
  assert.equal(api.streamCalls, 1);
});

scenario('a meeting that is already over is said so and not retried', async ({ api, start, until }) => {
  api.starts.push(refusal(409, { error: 'meeting_not_live', end_reason: 'bot_failed' }));
  start();
  const s = await until((x) => x?.phase === 'not_started');
  assert.equal(s.startFailure, 'meeting_over');
  assert.equal(s.endReason, 'bot_failed');
  await wait();
  assert.equal(api.startCalls, 1);
});

scenario('no credits is said so', async ({ api, start, until, failures }) => {
  api.starts.push(refusal(402));
  start();
  assert.equal((await until((x) => x?.phase === 'not_started')).startFailure, 'no_credits');
  await wait();
  assert.equal(api.startCalls, 1);
  assert.deepEqual(failures, []);
});

scenario('a start lost on the network is repeated', async ({ api, add, start, until }) => {
  api.starts.push(refusal(0), refusal(502));
  add();
  start();
  await until((s) => s?.phase === 'live');
  assert.equal(api.startCalls, 3);
});

scenario('a start that keeps failing gives up, and the user can retry it', async ({ api, add, coach, start, until, failures }) => {
  api.starts.push(refusal(500), refusal(500), refusal(500));
  start();
  assert.equal((await until((x) => x?.phase === 'not_started')).startFailure, 'other');
  assert.equal(api.startCalls, 3);
  assert.deepEqual(failures, [['coach_start', 500]]);
  add();
  coach.retry(MEET);
  await until((s) => s.phase === 'live');
  assert.equal(api.startCalls, 4);
});

scenario('other refusals are not repeated automatically', async ({ api, start, until }) => {
  api.starts.push(refusal(400));
  start();
  assert.equal((await until((x) => x?.phase === 'not_started')).startFailure, 'other');
  await wait();
  assert.equal(api.startCalls, 1);
});

scenario('a dropped connection is reopened and missed tips are fetched', async ({ api, add, start, until }) => {
  const first = add();
  const second = add();
  start();
  await until((s) => s?.phase === 'live');
  first.tip('t1');
  await until((s) => s.insights.length === 1);
  api.latest = latest({ id: 's1' }, [tip('t1'), tip('t2')]);
  first.drop();
  assert.deepEqual(ids(await until((s) => s.insights.length === 2)), ['t2', 't1']);
  await until((s) => s.phase === 'live' && api.streamCalls === 2);
  second.tip('t2'); second.tip('t3');
  assert.deepEqual(ids(await until((s) => s.insights.length === 3)), ['t3', 't2', 't1']);
  assert.equal(api.ended.length, 0);
});

scenario('a session that ended while disconnected stops reconnecting', async ({ api, add, start, until }) => {
  const stream = add();
  start();
  await until((s) => s?.phase === 'live');
  api.latest = latest({ id: 's1', ended_at: '2026-01-01T00:10:00', refunded: true, end_reason: 'no_speech' });
  stream.drop();
  const end = await until((s) => s.phase === 'ended');
  assert.equal(end.endReason, 'no_speech');
  assert.equal(end.refunded, true);
  await wait();
  assert.equal(api.streamCalls, 1);
});

scenario('a stream the server refuses as ended or gone ends the session here', async ({ api, start, until }) => {
  for (const status of [400, 404]) {
    api.streams.push(refusal(status));
    start();
    await until((s) => s?.phase === 'ended');
  }
  await wait();
  assert.equal(api.streamCalls, 2);
});

scenario('a long outage keeps reconnecting and is reported once', async ({ api, start, until, failures }) => {
  start();
  await until((s) => s?.phase === 'reconnecting' && api.streamCalls >= 9);
  assert.deepEqual(failures, [['coach_stream', 0]]);
});

scenario('reopening an earlier meeting shows its tips', async ({ api, coach, until }) => {
  api.latest = latest({ id: 's0', ended_at: '2026-01-01T00:10:00' }, [tip('t1'), tip('t2')]);
  await coach.attach(MEET, 'rec-1');
  const s = await until((x) => x?.phase === 'ended');
  assert.deepEqual(ids(s), ['t2', 't1']);
  assert.equal(api.streamCalls, 0);
});

scenario('looking at an earlier meeting leaves the running session alone and still shows its tips', async ({ api, add, coach, start, until }) => {
  const stream = add();
  start();
  await until((s) => s?.phase === 'live');
  api.latest = latest({ id: 's0', ended_at: '2026-01-01T00:10:00' }, [tip('t1')]);
  await coach.attach('meet-0', 'rec-0');
  assert.equal(coach.getState('meet-0').phase, 'ended');
  assert.equal(coach.getState('meet-0').insights.length, 1);
  assert.equal(coach.getState(MEET).phase, 'live');
  assert.equal(stream.aborted, false);
});

scenario('after a reload the open session is picked up, without starting another', async ({ api, add, coach, until }) => {
  api.latest = latest({ id: 's1' }, [tip('t1')]);
  const stream = add();
  await coach.attach(MEET, 'rec-1');
  await until((s) => s?.phase === 'live');
  stream.tip('t1'); stream.tip('t2'); // the server replays what exists, then continues
  assert.deepEqual(ids(await until((s) => s.insights.length === 2)), ['t2', 't1']);
  assert.equal(api.startCalls, 0);
});

scenario('picking up a session survives a failed first look', async ({ api, add, coach, until }) => {
  api.latestFailures.push(refusal(0), refusal(503));
  api.latest = latest({ id: 's1' });
  add();
  await Promise.all([coach.attach(MEET, 'rec-1'), coach.attach(MEET, 'rec-1')]);
  await until((s) => s?.phase === 'live');
  assert.equal(api.latestCalls, 3);
  assert.equal(api.streamCalls, 1);
});

scenario('a meeting without a session shows nothing, and is looked at again next time', async ({ api, coach }) => {
  await coach.attach(MEET, 'rec-1');
  assert.equal(coach.getState(MEET), null);
  await coach.attach(MEET, 'rec-1');
  assert.equal(api.latestCalls, 2);
});

scenario('a slow look does not overwrite a session started meanwhile', async ({ api, add, coach, start, until }) => {
  api.latest = latest({ id: 's0', ended_at: '2026-01-01T00:10:00' });
  add();
  const looking = coach.attach(MEET, 'rec-1');
  start();
  await looking;
  await until((s) => s.phase === 'live');
});

scenario('a stop that cannot reach the server is repeated until it does', async ({ api, add, coach, start, until }) => {
  const stream = add();
  start();
  await until((s) => s?.phase === 'live');
  api.endFailures.push(refusal(0), refusal(503));
  coach.stop(MEET);
  assert.equal(coach.getState(MEET).phase, 'ended');
  assert.equal(coach.getState(MEET).endReason, STOPPED_BY_USER);
  assert.equal(stream.aborted, true);
  await until((s) => s.refunded);
  assert.equal(api.endCalls, 3);
  assert.deepEqual(api.ended, ['s1']);
  assert.equal(api.streamCalls, 1);
});

scenario('a refund is still said when the first answer to a stop was lost', async ({ api, add, coach, start, until }) => {
  add();
  start();
  await until((s) => s?.phase === 'live');
  api.endFailures.push(refusal(0));
  api.endRefunded = false; // the repeat finds the session already ended
  api.latest = latest({ id: 's1', ended_at: '2026-01-01T00:10:00', refunded: true });
  coach.stop(MEET);
  await until((s) => s.refunded);
});

scenario('an unacknowledged stop is not shown as running again', async ({ api, add, coach, start, until }) => {
  add();
  start();
  await until((s) => s?.phase === 'live');
  api.endFailures.push(...Array.from({ length: 50 }, () => refusal(0)));
  coach.stop(MEET);
  api.latest = latest({ id: 's1' });
  await coach.attach(MEET, 'rec-1');
  assert.equal(coach.getState(MEET).phase, 'ended');
  assert.equal(api.streamCalls, 1);
});

scenario('asking for coaching again overrides a stop that never reached the server', async ({ api, add, coach, start, until }) => {
  add();
  start();
  await until((s) => s?.phase === 'live');
  api.endFailures.push(...Array.from({ length: 50 }, () => refusal(0)));
  coach.stop(MEET);
  add();
  start();
  await until((s) => s.phase === 'live');
  const calls = api.endCalls;
  await wait();
  assert.equal(api.endCalls, calls);
});

/** sessionStorage of one tab: it outlives the store, as it outlives a reload. */
function tabStorage() {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v), saved: () => JSON.parse(items.get('mm_coach_stops') ?? '[]') };
}

test('a stop the server never heard survives a reload: shown as stopped and sent again', async () => {
  const storage = tabStorage();
  const before = setup({ storage });
  let offline;
  try {
    before.add();
    before.start();
    await before.until((s) => s?.phase === 'live');
    before.api.endFailures.push(...Array.from({ length: 1000 }, () => refusal(0)));
    before.coach.stop(MEET);
    assert.deepEqual(storage.saved(), [{ sessionId: 's1', recordingId: 'rec-1' }]);

    // The reloaded page, still offline for the end call.
    offline = setup({ storage }, (api) => api.endFailures.push(...Array.from({ length: 1000 }, () => refusal(0))));
    offline.api.latest = latest({ id: 's1' }, [tip('t1')]);
    await offline.coach.attach(MEET, 'rec-1');
    assert.equal(offline.coach.getState(MEET).phase, 'ended');
    assert.equal(offline.coach.getState(MEET).endReason, STOPPED_BY_USER);
    assert.equal(offline.api.streamCalls, 0);
    assert.ok(offline.api.endCalls >= 1, 'sent again as soon as the page was back');
  } finally {
    before.coach.reset();
    offline?.coach.reset();
  }
});

test('a saved stop is sent as soon as the page is back, and the refund of an earlier try is still said', async () => {
  const storage = tabStorage();
  storage.setItem('mm_coach_stops', JSON.stringify([{ sessionId: 's1', recordingId: 'rec-1' }, { bad: true }]));
  const t = setup({ storage }, (api) => {
    api.endRefunded = false; // the request sent just before the reload had already ended it
    api.latest = latest({ id: 's1', ended_at: '2026-01-01T00:10:00', refunded: true });
  });
  await t.coach.attach(MEET, 'rec-1');
  await wait();
  assert.deepEqual(t.api.ended, ['s1']);
  assert.deepEqual(storage.saved(), []);
  assert.equal(t.coach.getState(MEET).refunded, true);
  t.coach.reset();
});

test('signing out drops saved stops, and unusable storage does not break stopping', async () => {
  const storage = tabStorage();
  const t = setup({ storage });
  t.add();
  t.start();
  await t.until((s) => s?.phase === 'live');
  t.api.endFailures.push(refusal(0), refusal(0), refusal(0));
  t.coach.stop(MEET);
  assert.equal(storage.saved().length, 1);
  t.coach.reset();
  assert.deepEqual(storage.saved(), []);

  const broken = setup({ storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  broken.add();
  broken.start();
  await broken.until((s) => s?.phase === 'live');
  broken.coach.stop(MEET);
  await wait();
  assert.deepEqual(broken.api.ended, ['s1']);
  broken.coach.reset();
});

scenario('stop does nothing unless a session is running', async ({ api, coach, start, until }) => {
  coach.stop(MEET);
  api.starts.push(refusal(402));
  start();
  await until((s) => s?.phase === 'not_started');
  coach.stop(MEET);
  assert.equal(coach.getState(MEET).phase, 'not_started');
  assert.equal(api.endCalls, 0);
});

scenario('signing out forgets the sessions and stops reconnecting', async ({ api, add, coach, start, until }) => {
  const stream = add();
  start();
  await until((s) => s?.phase === 'live');
  stream.tip('t1');
  await until((s) => s.insights.length === 1);
  api.latest = latest({ id: 's1' });
  stream.drop();
  await until((s) => s.phase === 'reconnecting');
  coach.reset();
  assert.equal(coach.getState(MEET), null);
  const calls = api.streamCalls;
  await wait();
  assert.equal(api.streamCalls, calls);
  assert.equal(coach.getState(MEET), null);
});

scenario('signing out while a session is being picked up shows nothing', async ({ api, coach }) => {
  api.latest = latest({ id: 's1' });
  const looking = coach.attach(MEET, 'rec-1');
  coach.reset();
  await looking;
  assert.equal(coach.getState(MEET), null);
  assert.equal(api.streamCalls, 0);
});

scenario('a refused account stops reconnecting', async ({ api, start, until }) => {
  for (const status of [401, 403]) {
    api.streams.push(refusal(status));
    start();
    await until((s) => s === null && api.streamCalls === (status === 401 ? 1 : 2));
  }
  await wait();
  assert.equal(api.streamCalls, 2);
});

scenario('listeners hear of changes and the state object is stable between them', async ({ add, coach, start, until }) => {
  let heard = 0;
  const off = coach.subscribe(() => heard++);
  add();
  start();
  await until((s) => s?.phase === 'live');
  assert.equal(heard, 2);
  assert.equal(coach.getState(MEET), coach.getState(MEET));
  off();
  coach.stop(MEET);
  assert.equal(heard, 2);
});

const state = (over) => ({ phase: 'ended', insights: [], endReason: null, refunded: false, startFailure: null, ...over });

test('every state says what the coach is doing, in the Android wording', () => {
  const cases = [
    [{ phase: 'live' }, null],
    [{ phase: 'starting' }, 'Starting AI Coach…'],
    [{ phase: 'reconnecting' }, 'Reconnecting…'],
    [{ phase: 'not_started', startFailure: 'no_credits' }, 'AI Coach did not start because you have no sessions left.'],
    [{ phase: 'not_started', startFailure: 'meeting_over' }, 'AI Coach did not start because the bot is no longer in the meeting.'],
    [{ phase: 'not_started', startFailure: 'other' }, 'AI Coach could not start. Check your connection and try again.'],
    [{ endReason: 'bot_not_admitted' }, 'AI Coach stopped because the bot was not let into the meeting.'],
    [{ endReason: 'bot_failed' }, 'AI Coach stopped because the bot could not join the meeting.'],
    [{ endReason: 'no_speech' }, 'AI Coach ended without hearing any speech.'],
    [{ endReason: 'model_failed' }, 'AI Coach could not create tips because of a problem on our side.'],
    [{ endReason: 'meeting_ended' }, 'AI Coach has ended.'],
    [{ endReason: 'client' }, 'AI Coach has ended.'],
    [{ endReason: null }, 'AI Coach has ended.'],
  ];
  for (const [over, text] of cases) assert.equal(coachingStatusText(state(over)), text, JSON.stringify(over));
});

test('the credit is mentioned only when something happened to it', () => {
  assert.equal(coachingCreditText(state({ refunded: true })), 'Your session credit was returned.');
  assert.equal(coachingCreditText(state({})), null);
  assert.equal(coachingCreditText(state({ phase: 'not_started', startFailure: 'meeting_over' })), 'No credit was used.');
  assert.equal(coachingCreditText(state({ phase: 'not_started', startFailure: 'no_credits' })), null);
});

test('sessions left and tip times', () => {
  assert.deepEqual([0, 1, 2].map(sessionsLeftText), ['No sessions left', '1 session left', '2 sessions left']);
  assert.equal(tipOffsetText(247), '4:07');
  assert.equal(tipOffsetText(0), '0:00');
  assert.equal(tipOffsetText(null), null);
});
