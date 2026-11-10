import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));

import { VoiceMetrics, percentile, summarizeDay, emptyDay, applyEvent, usageGauges, isMissingTable, type EventStore, type VaEvent } from '../../src/services/voiceAssistant/metrics.js';
import { loadVoiceAssistantConfig } from '../../src/services/voiceAssistant/config.js';

const DAY = Date.parse('2026-11-10T12:00:00Z');
const cfg = (env: Record<string, string> = {}) => () => loadVoiceAssistantConfig({ VOICE_ASSISTANT_MODE: 'all', ...env } as NodeJS.ProcessEnv);

function mk(env: Record<string, string> = {}, store: EventStore | null = null, now = { t: DAY }) {
  const lines: string[] = [];
  const alerts: string[] = [];
  const pushed: Array<{ day: string; gauges: Array<{ metric: string; value: number }> }> = [];
  const m = new VoiceMetrics({
    getConfig: cfg(env), now: () => now.t, store, log: (l) => lines.push(l), alert: (_f, c) => { alerts.push(c); },
    pushUsage: async (day, gauges) => { pushed.push({ day, gauges }); }, pushIntervalMs: 1000,
  });
  return { m, lines, alerts, pushed, now };
}

describe('percentile and roll-up', () => {
  it('p50 / p95', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([100], 95)).toBe(100);
    const xs = Array.from({ length: 100 }, (_, i) => (i + 1) * 10);
    expect(percentile(xs, 50)).toBe(500);
    expect(percentile(xs, 95)).toBe(950);
  });

  it('summarizes every metric the owner asked for', () => {
    const d = emptyDay('2026-11-10');
    const ev = (e: Partial<VaEvent> & { type: VaEvent['type'] }) => applyEvent(d, { at: DAY, userId: 'u1', meetingId: 'm1', ...e });
    ev({ type: 'wake' }); ev({ type: 'wake' }); ev({ type: 'wake' });
    ev({ type: 'question' }); ev({ type: 'question', meetingId: 'm2', userId: 'u2' }); ev({ type: 'question' });
    ev({ type: 'answered', ttfaMs: 400, answerMs: 2500, llmUsd: 0.003, ttsUsd: 0.001, found: true });
    ev({ type: 'answered', ttfaMs: 600, answerMs: 4000, llmUsd: 0.003, ttsUsd: 0.001, found: false });
    ev({ type: 'failed', failure: 'tts' });
    ev({ type: 'barge_in', detail: 'speaking' }); ev({ type: 'echo_suppressed' }); ev({ type: 'stale_dropped', detail: 'age' });
    ev({ type: 'cap_hit', detail: 'user_day' }); ev({ type: 'history_denied' });
    const r = summarizeDay(d, 'memory');
    expect(r).toMatchObject({
      wakeDetections: 3, questions: 3, answered: 2, noAnswerFound: 1, bargeIns: 1, echoSuppressed: 1, staleDropped: 1, historyDenied: 1,
      meetingsWithQuestions: 2, usersWithQuestions: 2, questionsPerMeetingMax: 2,
    });
    expect(r.failures).toMatchObject({ tts: 1, llm: 0, total: 1 });
    expect(r.failureRate).toBeCloseTo(1 / 3, 3);
    expect(r.capHits.user_day).toBe(1);
    expect(r.ttfaMs).toEqual({ p50: 400, p95: 600, n: 2 });
    expect(r.answerMs.p95).toBe(4000);
    expect(r.costUsd).toMatchObject({ llm: 0.006, tts: 0.002, total: 0.008, perAnswer: 0.004 });
    expect(r.topUsers[0]).toEqual({ userId: 'u1', questions: 2 });
    const names = usageGauges(r).map((g) => g.metric);
    expect(names).toEqual(expect.arrayContaining(['voice.answered', 'voice.ttfa_p95_ms', 'voice.cost_usd', 'voice.no_answer']));
    expect(names.every((n) => /^[a-z0-9_.-]+$/i.test(n))).toBe(true);
  });
});

describe('VoiceMetrics', () => {
  it('logs one JSON line per event with no content fields, and pushes gauges to the Worker', async () => {
    const { m, lines, pushed } = mk();
    m.record({ type: 'question', userId: 'u1', meetingId: 'm1' });
    m.record({ type: 'answered', userId: 'u1', meetingId: 'm1', ttfaMs: 300, answerMs: 2000, llmUsd: 0.002, ttsUsd: 0.0006, found: true });
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.every((p) => p.event === 'voice_assistant')).toBe(true);
    expect(Object.keys(parsed[1]).sort()).toEqual(['answerMs', 'at', 'event', 'found', 'llmUsd', 'meetingId', 'ttfaMs', 'ttsUsd', 'type', 'userId']);
    expect(pushed.length).toBeGreaterThanOrEqual(1);
    expect(pushed[0]!.day).toBe('2026-11-10');
  });

  it('daily spend over the cap alerts, and the live read says so', () => {
    const { m, alerts } = mk({ VOICE_ASSISTANT_DAILY_SPEND_CAP_USD: '0.01' });
    m.record({ type: 'answered', llmUsd: 0.006, ttsUsd: 0.001 });
    expect(alerts).not.toContain('DAILY_SPEND_CAP_REACHED');
    m.record({ type: 'answered', llmUsd: 0.006, ttsUsd: 0.001 });
    expect(alerts).toContain('DAILY_SPEND_CAP_REACHED');
    expect(m.spendUsd()).toBeCloseTo(0.014, 6);
  });

  it('failure rate over the threshold alerts only once enough attempts exist', () => {
    const { m, alerts } = mk({ VOICE_ASSISTANT_FAILURE_ALERT_MIN_ATTEMPTS: '4', VOICE_ASSISTANT_FAILURE_ALERT_RATE: '0.3' });
    m.record({ type: 'failed', failure: 'llm' }); m.record({ type: 'failed', failure: 'llm' });
    expect(alerts).toEqual([]);
    m.record({ type: 'answered' }); m.record({ type: 'answered' });
    expect(alerts).toContain('FAILURE_RATE_HIGH');
    const healthy = mk({ VOICE_ASSISTANT_FAILURE_ALERT_MIN_ATTEMPTS: '4' });
    for (let i = 0; i < 9; i++) healthy.m.record({ type: 'answered' });
    healthy.m.record({ type: 'failed', failure: 'play' });
    expect(healthy.alerts).toEqual([]);
  });

  it('counters roll over at UTC midnight', () => {
    const { m, now } = mk();
    m.record({ type: 'question', userId: 'u1' });
    expect(m.userQuestionsToday('u1')).toBe(1);
    now.t += 13 * 3_600_000;
    expect(m.userQuestionsToday('u1')).toBe(0);
  });

  it('never throws into the meeting, even when the store explodes', () => {
    const store: EventStore = { insert: () => { throw new Error('sync boom'); }, since: async () => [] };
    const { m } = mk({}, store);
    expect(() => m.record({ type: 'wake' })).not.toThrow();
  });
});

describe('table sink (migration 029) and its absence', () => {
  const rows: VaEvent[] = [
    { type: 'question', at: DAY - 1000, userId: 'u1', meetingId: 'm1' },
    { type: 'question', at: DAY - 900, userId: 'u1', meetingId: 'm1' },
    { type: 'answered', at: DAY - 800, userId: 'u1', meetingId: 'm1', ttfaMs: 500, answerMs: 3000, llmUsd: 0.4, ttsUsd: 0.1, found: true },
  ];

  it('hydrate() rebuilds today from the table, so the per-user cap and the spend breaker survive a restart', async () => {
    const store: EventStore = { insert: async () => {}, since: async () => rows };
    const { m } = mk({}, store);
    expect(m.userQuestionsToday('u1')).toBe(0);
    await m.hydrate();
    expect(m.userQuestionsToday('u1')).toBe(2);
    expect(m.spendUsd()).toBeCloseTo(0.5, 6);
  });

  it('a missing table switches the sink off once and everything keeps working in memory', async () => {
    const warn: string[] = [];
    let inserts = 0;
    const store: EventStore = {
      insert: async () => { inserts++; throw Object.assign(new Error('relation "voice_assistant_events" does not exist'), { code: '42P01' }); },
      since: async () => [],
    };
    const lines: string[] = [];
    const m = new VoiceMetrics({ getConfig: cfg(), now: () => DAY, store, log: (l) => { lines.push(l); warn.push(l); }, alert: () => {}, pushUsage: null });
    await m.hydrate();
    m.record({ type: 'question', userId: 'u1', meetingId: 'm1' });
    await new Promise((r) => setImmediate(r));
    m.record({ type: 'question', userId: 'u1', meetingId: 'm1' });
    await new Promise((r) => setImmediate(r));
    expect(inserts).toBe(1); // switched off after the first failure
    expect(m.userQuestionsToday('u1')).toBe(2);
    const roll = await m.rollup(7);
    expect(roll).toHaveLength(1);
    expect(roll[0]).toMatchObject({ source: 'memory', questions: 2 });
    expect(isMissingTable({ code: '42P01' })).toBe(true);
    expect(isMissingTable({ message: 'Could not find the table in the schema cache' })).toBe(true);
    expect(isMissingTable({ code: '08006' })).toBe(false);
  });

  it('multi-day roll-up groups stored events by UTC day, newest first', async () => {
    const store: EventStore = {
      insert: async () => {},
      since: async () => [
        { type: 'answered', at: DAY - 86_400_000, ttfaMs: 700, answerMs: 4000 },
        { type: 'answered', at: DAY, ttfaMs: 300, answerMs: 2000 },
        { type: 'failed', at: DAY, failure: 'llm' },
      ],
    };
    const { m } = mk({}, store);
    const roll = await m.rollup(3);
    expect(roll.map((r) => r.day)).toEqual(['2026-11-10', '2026-11-09']);
    expect(roll[0]).toMatchObject({ source: 'database', answered: 1, failureRate: 0.5 });
  });
});
