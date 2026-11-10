/**
 * Voice assistant metrics. One typed event per thing that happens, folded into per-UTC-day counters.
 *
 * Privacy: events carry ids, counts, durations, dollar estimates and stable codes. They NEVER carry question text, answer text,
 * transcript text, speaker names or meeting titles. (The transcript and the answers are not stored by this feature.)
 *
 * Sinks (all best effort, none may throw into a meeting):
 *   1. one structured JSON log line per event:   fly logs -a summary-ai-backend | grep '"event":"voice_assistant"'
 *   2. table voice_assistant_events (migration 029, NOT applied by this PR). If the table is missing the sink switches itself off
 *      after one warning and everything else keeps working (counters live in memory for the day).
 *   3. the central Worker: daily gauges `voice.*` through POST /v1/usage (idempotent set per app/day/metric), read on its /admin page.
 *   4. alerts through lib/alerts.ts (stable messages, deduped by the Worker): failure rate over the last hour, daily spend cap.
 *
 * Counters are a fold over events, so after a restart `hydrate()` rebuilds the day from the table (when it exists) by replaying
 * the rows through the same fold. That also keeps the per-user daily cap and the daily spend breaker honest across deploys.
 */
import { supabaseAdmin } from '../../lib/supabase.js';
import { reportAlert } from '../../lib/alerts.js';
import type { VoiceAssistantConfig } from './config.js';

export type FailureType = 'llm' | 'tts' | 'play' | 'timeout' | 'internal';
export type CapKind = 'meeting' | 'user_day' | 'spend';
export type VaEventType =
  | 'wake' | 'question' | 'answered' | 'failed' | 'barge_in' | 'stale_dropped'
  | 'echo_suppressed' | 'cap_hit' | 'history_denied' | 'intro' | 'cue';

export interface VaEvent {
  type: VaEventType;
  at: number; // epoch ms
  userId?: string;
  meetingId?: string;
  /** answered */
  ttfaMs?: number; // end of question (final transcript received) -> first audio sent (cue if enabled, else the answer)
  answerMs?: number; // end of question -> answer audio sent
  llmMs?: number;
  ttsMs?: number;
  llmUsd?: number;
  ttsUsd?: number;
  found?: boolean;
  ownerSpeaker?: boolean;
  tools?: number;
  chars?: number;
  /** failed */
  failure?: FailureType;
  /** barge_in: 'speaking' | 'thinking'. cap_hit: CapKind. history_denied / stale_dropped: short code. */
  detail?: string;
}

export interface DayCounters {
  day: string;
  wakes: number;
  questions: number;
  answered: number;
  noAnswer: number;
  failures: Record<FailureType, number>;
  bargeIns: number;
  staleDropped: number;
  echoSuppressed: number;
  capHits: Record<CapKind, number>;
  historyDenied: number;
  intros: number;
  cues: number;
  llmUsd: number;
  ttsUsd: number;
  ttfaMs: number[];
  answerMs: number[];
  meetings: Map<string, number>; // meetingId -> questions
  users: Map<string, number>; // userId -> questions
}

const MAX_SAMPLES = 5000;
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function emptyDay(day: string): DayCounters {
  return {
    day, wakes: 0, questions: 0, answered: 0, noAnswer: 0,
    failures: { llm: 0, tts: 0, play: 0, timeout: 0, internal: 0 },
    bargeIns: 0, staleDropped: 0, echoSuppressed: 0,
    capHits: { meeting: 0, user_day: 0, spend: 0 },
    historyDenied: 0, intros: 0, cues: 0, llmUsd: 0, ttsUsd: 0,
    ttfaMs: [], answerMs: [], meetings: new Map(), users: new Map(),
  };
}

/** The single fold: counters = events.reduce(applyEvent). Also used to rebuild a day from stored rows. */
export function applyEvent(d: DayCounters, e: VaEvent): void {
  switch (e.type) {
    case 'wake': d.wakes++; break;
    case 'question':
      d.questions++;
      if (e.meetingId) d.meetings.set(e.meetingId, (d.meetings.get(e.meetingId) ?? 0) + 1);
      if (e.userId) d.users.set(e.userId, (d.users.get(e.userId) ?? 0) + 1);
      break;
    case 'answered':
      d.answered++;
      if (e.found === false) d.noAnswer++;
      d.llmUsd += e.llmUsd ?? 0;
      d.ttsUsd += e.ttsUsd ?? 0;
      if (typeof e.ttfaMs === 'number' && d.ttfaMs.length < MAX_SAMPLES) d.ttfaMs.push(e.ttfaMs);
      if (typeof e.answerMs === 'number' && d.answerMs.length < MAX_SAMPLES) d.answerMs.push(e.answerMs);
      break;
    case 'failed':
      d.failures[e.failure ?? 'internal']++;
      d.llmUsd += e.llmUsd ?? 0;
      d.ttsUsd += e.ttsUsd ?? 0;
      break;
    case 'barge_in': d.bargeIns++; break;
    case 'stale_dropped': d.staleDropped++; break;
    case 'echo_suppressed': d.echoSuppressed++; break;
    case 'cap_hit': d.capHits[(e.detail as CapKind) in d.capHits ? (e.detail as CapKind) : 'meeting']++; break;
    case 'history_denied': d.historyDenied++; break;
    case 'intro': d.intros++; d.ttsUsd += e.ttsUsd ?? 0; break;
    case 'cue': d.cues++; break;
  }
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Math.round(s[idx]!);
}

export interface Rollup {
  day: string;
  source: 'database' | 'memory';
  wakeDetections: number;
  questions: number;
  answered: number;
  noAnswerFound: number;
  failures: Record<FailureType, number> & { total: number };
  failureRate: number | null;
  bargeIns: number;
  staleDropped: number;
  echoSuppressed: number;
  capHits: Record<CapKind, number>;
  historyDenied: number;
  ttfaMs: { p50: number | null; p95: number | null; n: number };
  answerMs: { p50: number | null; p95: number | null; n: number };
  meetingsWithQuestions: number;
  usersWithQuestions: number;
  questionsPerMeetingMax: number;
  topUsers: Array<{ userId: string; questions: number }>;
  costUsd: { llm: number; tts: number; total: number; perAnswer: number | null };
}

export function summarizeDay(d: DayCounters, source: Rollup['source']): Rollup {
  const failTotal = Object.values(d.failures).reduce((a, b) => a + b, 0);
  const attempts = d.answered + failTotal;
  const total = d.llmUsd + d.ttsUsd;
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    day: d.day, source,
    wakeDetections: d.wakes, questions: d.questions, answered: d.answered, noAnswerFound: d.noAnswer,
    failures: { ...d.failures, total: failTotal },
    failureRate: attempts > 0 ? Math.round((failTotal / attempts) * 1000) / 1000 : null,
    bargeIns: d.bargeIns, staleDropped: d.staleDropped, echoSuppressed: d.echoSuppressed,
    capHits: { ...d.capHits }, historyDenied: d.historyDenied,
    ttfaMs: { p50: percentile(d.ttfaMs, 50), p95: percentile(d.ttfaMs, 95), n: d.ttfaMs.length },
    answerMs: { p50: percentile(d.answerMs, 50), p95: percentile(d.answerMs, 95), n: d.answerMs.length },
    meetingsWithQuestions: d.meetings.size, usersWithQuestions: d.users.size,
    questionsPerMeetingMax: Math.max(0, ...d.meetings.values()),
    topUsers: [...d.users.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([userId, questions]) => ({ userId, questions })),
    costUsd: { llm: r6(d.llmUsd), tts: r6(d.ttsUsd), total: r6(total), perAnswer: d.answered > 0 ? r6(total / d.answered) : null },
  };
}

/** Gauges pushed to the Worker (POST /v1/usage, set per app/day/metric). Names are lowercase [a-z0-9_.]. */
export function usageGauges(r: Rollup): Array<{ metric: string; value: number }> {
  const g = (metric: string, value: number | null) => (value === null ? [] : [{ metric, value }]);
  return [
    ...g('voice.wake_detections', r.wakeDetections), ...g('voice.questions', r.questions), ...g('voice.answered', r.answered),
    ...g('voice.no_answer', r.noAnswerFound), ...g('voice.failures', r.failures.total), ...g('voice.barge_ins', r.bargeIns),
    ...g('voice.stale_dropped', r.staleDropped), ...g('voice.echo_suppressed', r.echoSuppressed),
    ...g('voice.meetings', r.meetingsWithQuestions), ...g('voice.users', r.usersWithQuestions),
    ...g('voice.ttfa_p50_ms', r.ttfaMs.p50), ...g('voice.ttfa_p95_ms', r.ttfaMs.p95),
    ...g('voice.answer_p50_ms', r.answerMs.p50), ...g('voice.answer_p95_ms', r.answerMs.p95),
    ...g('voice.cost_usd', Math.round(r.costUsd.total * 10_000) / 10_000),
  ];
}

export interface EventStore {
  insert(e: VaEvent): Promise<void>;
  /** Events at or after `sinceMs`, oldest first, at most `limit`. Throws if the table is unavailable. */
  since(sinceMs: number, limit: number): Promise<VaEvent[]>;
}

const TABLE = 'voice_assistant_events';

/** Production store: one row per event in voice_assistant_events. */
export function supabaseEventStore(): EventStore {
  return {
    async insert(e) {
      const { error } = await supabaseAdmin.from(TABLE).insert({
        event: e.type, user_id: e.userId ?? null, meeting_id: e.meetingId ?? null, created_at: new Date(e.at).toISOString(),
        ttfa_ms: e.ttfaMs ?? null, answer_ms: e.answerMs ?? null, llm_ms: e.llmMs ?? null, tts_ms: e.ttsMs ?? null,
        llm_usd: e.llmUsd ?? null, tts_usd: e.ttsUsd ?? null, found: e.found ?? null, owner_speaker: e.ownerSpeaker ?? null,
        tools: e.tools ?? null, chars: e.chars ?? null, failure: e.failure ?? null, detail: e.detail ?? null,
      });
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
    },
    async since(sinceMs, limit) {
      const { data, error } = await supabaseAdmin.from(TABLE)
        .select('event, user_id, meeting_id, created_at, ttfa_ms, answer_ms, llm_ms, tts_ms, llm_usd, tts_usd, found, owner_speaker, tools, chars, failure, detail')
        .gte('created_at', new Date(sinceMs).toISOString()).order('created_at', { ascending: true }).limit(limit);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return (data ?? []).map((r: any): VaEvent => ({
        type: r.event, at: Date.parse(r.created_at), userId: r.user_id ?? undefined, meetingId: r.meeting_id ?? undefined,
        ttfaMs: r.ttfa_ms ?? undefined, answerMs: r.answer_ms ?? undefined, llmMs: r.llm_ms ?? undefined, ttsMs: r.tts_ms ?? undefined,
        llmUsd: r.llm_usd == null ? undefined : Number(r.llm_usd), ttsUsd: r.tts_usd == null ? undefined : Number(r.tts_usd),
        found: r.found ?? undefined, ownerSpeaker: r.owner_speaker ?? undefined, tools: r.tools ?? undefined, chars: r.chars ?? undefined,
        failure: r.failure ?? undefined, detail: r.detail ?? undefined,
      }));
    },
  };
}

/** Postgres undefined_table, PostgREST schema-cache miss: the migration has not been applied. */
export function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '42P01' || e?.code === 'PGRST205' || /does not exist|schema cache/i.test(e?.message ?? '');
}

export interface MetricsOptions {
  now?: () => number;
  store?: EventStore | null;
  /** Push gauges to the Worker. Default: real push, disabled in test/development like the failure reporter. */
  pushUsage?: ((day: string, gauges: Array<{ metric: string; value: number }>) => Promise<void>) | null;
  alert?: (flow: string, code: string, ctx: Record<string, unknown>, throttleMs?: number) => unknown;
  log?: (line: string) => void;
  getConfig: () => VoiceAssistantConfig;
  pushIntervalMs?: number;
}

const HOUR = 3_600_000;

export class VoiceMetrics {
  private day: DayCounters;
  private hydratedDay: string | null = null;
  private storeOk: boolean;
  private lastPush = 0;
  private attempts: Array<{ t: number; ok: boolean }> = [];
  private readonly now: () => number;
  private readonly store: EventStore | null;
  private readonly opts: MetricsOptions;

  constructor(opts: MetricsOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.store = opts.store === undefined ? null : opts.store;
    this.storeOk = !!this.store;
    this.day = emptyDay(utcDay(this.now()));
  }

  /** Make sure the in-memory day is today's and, once per day per process, rebuilt from the table. Never throws. */
  async hydrate(): Promise<void> {
    const today = utcDay(this.now());
    if (this.day.day !== today) this.day = emptyDay(today);
    if (this.hydratedDay === today) return;
    this.hydratedDay = today;
    if (!this.store || !this.storeOk) return;
    try {
      const dayStart = Date.parse(`${today}T00:00:00.000Z`);
      const rows = await this.store.since(dayStart, 20_000);
      const fresh = emptyDay(today);
      for (const r of rows) applyEvent(fresh, r);
      // The table is the source of truth for the day. hydrate() runs before the first question of the day is handled, so the
      // in-memory view holds at most a few in-flight events that are also on their way into the table.
      if (rows.length > 0) this.day = fresh;
    } catch (err) {
      this.handleStoreError(err, 'hydrate');
    }
  }

  private handleStoreError(err: unknown, what: string): void {
    if (isMissingTable(err)) {
      if (this.storeOk) (this.opts.log ?? console.warn)(`[VoiceAssistant] ${TABLE} is not available (migration 029 not applied?); metrics stay in memory and logs (${what})`);
      this.storeOk = false;
    } else {
      this.opts.alert?.('voice_assistant', 'METRICS_STORE_ERROR', { what });
    }
  }

  record(e: Omit<VaEvent, 'at'> & { at?: number }): void {
    try {
      const ev: VaEvent = { ...e, at: e.at ?? this.now() };
      const today = utcDay(ev.at);
      if (this.day.day !== today) this.day = emptyDay(today);
      applyEvent(this.day, ev);
      if (ev.type === 'answered') this.attempts.push({ t: ev.at, ok: true });
      if (ev.type === 'failed') this.attempts.push({ t: ev.at, ok: false });
      this.attempts = this.attempts.filter((a) => ev.at - a.t < HOUR);
      (this.opts.log ?? ((l: string) => console.log(l)))(JSON.stringify({ event: 'voice_assistant', ...ev, at: new Date(ev.at).toISOString() }));
      if (this.store && this.storeOk) this.store.insert(ev).catch((err) => this.handleStoreError(err, 'insert'));
      this.checkAlerts();
      this.maybePush();
    } catch { /* metrics must never cause a failure of their own */ }
  }

  private checkAlerts(): void {
    const cfg = this.opts.getConfig();
    const alert = this.opts.alert ?? ((flow: string, code: string, ctx: Record<string, unknown>, t?: number) => reportAlert(flow, code, ctx, t));
    const n = this.attempts.length;
    if (n >= cfg.failureAlertMinAttempts) {
      const failed = this.attempts.filter((a) => !a.ok).length;
      if (failed / n > cfg.failureAlertRate) {
        alert('voice_assistant', 'FAILURE_RATE_HIGH', { failed, attempts: n, windowMinutes: 60, threshold: cfg.failureAlertRate }, HOUR);
      }
    }
    if (this.spendUsd() >= cfg.dailySpendCapUsd) {
      alert('voice_assistant', 'DAILY_SPEND_CAP_REACHED', { spendUsd: Math.round(this.spendUsd() * 100) / 100, capUsd: cfg.dailySpendCapUsd }, 6 * HOUR);
    }
  }

  private maybePush(force = false): void {
    const push = this.opts.pushUsage;
    if (!push) return;
    const now = this.now();
    if (!force && now - this.lastPush < (this.opts.pushIntervalMs ?? 5 * 60_000)) return;
    this.lastPush = now;
    const r = summarizeDay(this.day, this.storeOk ? 'database' : 'memory');
    push(this.day.day, usageGauges(r)).catch(() => { /* best effort */ });
  }

  /** For shutdown. */
  async flush(): Promise<void> {
    const push = this.opts.pushUsage;
    if (!push) return;
    try { await push(this.day.day, usageGauges(summarizeDay(this.day, this.storeOk ? 'database' : 'memory'))); } catch { /* best effort */ }
  }

  // ---- reads used by the caps ----
  spendUsd(): number { this.rollDay(); return this.day.llmUsd + this.day.ttsUsd; }
  userQuestionsToday(userId: string): number { this.rollDay(); return this.day.users.get(userId) ?? 0; }
  today(): DayCounters { this.rollDay(); return this.day; }
  private rollDay(): void { const t = utcDay(this.now()); if (this.day.day !== t) this.day = emptyDay(t); }

  /** Roll-up for the last `days` UTC days, newest first. Uses the table when it exists, else today's memory only. */
  async rollup(days: number): Promise<Rollup[]> {
    const n = Math.min(Math.max(Math.floor(days) || 1, 1), 90);
    if (this.store && this.storeOk) {
      try {
        const start = Date.parse(`${utcDay(this.now() - (n - 1) * 86_400_000)}T00:00:00.000Z`);
        const rows = await this.store.since(start, 50_000);
        const byDay = new Map<string, DayCounters>();
        for (const r of rows) {
          const d = utcDay(r.at);
          if (!byDay.has(d)) byDay.set(d, emptyDay(d));
          applyEvent(byDay.get(d)!, r);
        }
        return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).map((d) => summarizeDay(d, 'database'));
      } catch (err) {
        this.handleStoreError(err, 'rollup');
      }
    }
    this.rollDay();
    return [summarizeDay(this.day, 'memory')];
  }
}

// ---- Worker push ----------------------------------------------------------------------------------------------

const USAGE_ENDPOINT = (process.env.FAILURE_REPORTER_URL || 'https://app-failure-reporter.t-sushanth.workers.dev/v1/report').replace(/\/v1\/report$/, '/v1/usage');

/** POST /v1/usage with the same per-app key the LLM spend module uses (LLM_USAGE_KEY, else FAILURE_REPORTER_KEY). */
export async function pushUsageToWorker(day: string, gauges: Array<{ metric: string; value: number }>): Promise<void> {
  const key = process.env.LLM_USAGE_KEY || process.env.FAILURE_REPORTER_KEY;
  if (!key || gauges.length === 0) return;
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development' || process.env.FAILURE_REPORTER_DISABLED === '1') return;
  await fetch(USAGE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Report-Key': key },
    body: JSON.stringify(gauges.map((g) => ({ ...g, day }))),
    signal: AbortSignal.timeout(5000),
  });
}
