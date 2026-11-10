/**
 * Soniox-primary live transcription: what happens when the Soniox stream fails during a meeting. See backend/LIVE_STT.md.
 *
 * There are two modes, decided when the bot is created (not mid-call: Recall documents transcription as a bot-creation setting):
 *
 *  - DEFAULT (no Recall transcript on the bot, costs nothing extra): a failure marks the meeting's live transcript
 *    `unavailable`. The bot keeps recording, every Soniox segment received so far stays, and the post-meeting final pass (which
 *    reads the recording, not the live rows) produces the transcript. The live stitcher backstop skips such a meeting, so a
 *    half-live transcript can never be saved as the final one.
 *  - HOT STANDBY (LIVE_STT_RECALL_HOT_STANDBY=true, allowlist stage only, +0.15 USD per hour): Recall's own transcript also runs.
 *    Its rows are stored hidden (live_transcripts.shadow = true, source_key null). On a failure the meeting switches to them from
 *    the last Soniox second onward: the hidden rows from that point become visible, later Soniox rows are stored hidden.
 *
 * Failure signals, all decided from the database so any Fly machine can act on them:
 *   explicit  the live-stt service reports `stream_fatal` (auth/config, no point retrying) or `stream_degraded` (it has already
 *             exhausted its own bounded reconnect/failover window) through POST /internal/live-segments {event}.
 *   silent    hot standby only: Recall final segments with real words end at least LIVE_STT_FALLBACK_SILENCE_SEC seconds of
 *             meeting time after the last Soniox segment, i.e. audio and speech exist but Soniox produced nothing.
 *   no_segments  default mode only: the bot has been in the call LIVE_STT_FALLBACK_NO_SEGMENTS_SEC seconds and Soniox never
 *             produced a segment (service down, cold start that never connected, capacity). Without Recall's transcript there is
 *             no proof that anyone spoke, so a silence AFTER the first segment is NOT treated as a failure in this mode.
 *
 * Retry: the Soniox retry is the service's own bounded reconnect (replay from its watermark). The backend adds one rule: if
 * segments arrive again after an outage was declared, the meeting returns to `ok` once (retries_used = 1). A second failure is
 * final for that meeting. In hot standby mode the switch is one way (no flip back), so there is nothing to retry.
 * Nothing here logs or stores transcript text, names or user ids.
 */
import { supabaseAdmin } from './supabase.js';
import { isMissingColumn } from '../services/meetingLanguage.js';
import { reportAlert } from './alerts.js';
import { inc, logEvent, refTag } from './liveSttMetrics.js';

export type FallbackMode = 'unavailable' | 'recall';
export type FallbackReason = 'auth' | 'connect' | 'closed' | 'rate_limit' | 'error' | 'degraded' | 'silent' | 'no_segments' | 'capacity';
export const FALLBACK_REASONS: readonly FallbackReason[] = ['auth', 'connect', 'closed', 'rate_limit', 'error', 'degraded', 'silent', 'no_segments', 'capacity'];

export interface FallbackEvent { t: string; kind: 'switch' | 'recovered'; reason: FallbackReason | 'segments_resumed'; at_sec: number }
export interface FallbackState {
  v: 1;
  /** true while the outage is current (unavailable) or while Recall is the visible source (recall). */
  active: boolean;
  mode: FallbackMode;
  /** Meeting time (seconds) of the last Soniox segment when the switch happened. Recall rows from here on are the visible ones. */
  switched_at_sec: number;
  switched_at: string;
  reason: FallbackReason;
  retries_used: 0 | 1;
  events: FallbackEvent[];
}

export interface FallbackConfig {
  /** LIVE_STT_FALLBACK is not off. */
  enabled: boolean;
  hotStandby: boolean;
  silenceSec: number;
  noSegmentsSec: number;
  minRecallWords: number;
  sweepSec: number;
}

function num(v: string | undefined, d: number, min: number): number {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= min ? n : d;
}

export function fallbackConfigFrom(env: Record<string, string | undefined> = process.env): FallbackConfig {
  return {
    enabled: !['off', 'false', '0', 'no'].includes((env.LIVE_STT_FALLBACK ?? '').trim().toLowerCase()),
    hotStandby: ['true', 'on', '1', 'yes'].includes((env.LIVE_STT_RECALL_HOT_STANDBY ?? '').trim().toLowerCase()),
    // Longer than the service's own reconnect + failover window (30 s) so its retry gets a chance first.
    silenceSec: num(env.LIVE_STT_FALLBACK_SILENCE_SEC, 45, 10),
    noSegmentsSec: num(env.LIVE_STT_FALLBACK_NO_SEGMENTS_SEC, 300, 30),
    minRecallWords: num(env.LIVE_STT_FALLBACK_MIN_RECALL_WORDS, 3, 1),
    sweepSec: num(env.LIVE_STT_FALLBACK_SWEEP_SEC, 30, 5),
  };
}

/** Hot standby is for the allowlist stage only: the Recall transcript costs 0.15 USD per hour on every such meeting. */
export function standbyAllowedFor(cfg: Pick<FallbackConfig, 'hotStandby'>, selection: string): boolean {
  return cfg.hotStandby && selection === 'allowlist';
}

export function parseFallbackState(raw: unknown): FallbackState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.active !== 'boolean' || (r.mode !== 'unavailable' && r.mode !== 'recall')) return null;
  return {
    v: 1,
    active: r.active,
    mode: r.mode,
    switched_at_sec: typeof r.switched_at_sec === 'number' ? r.switched_at_sec : 0,
    switched_at: typeof r.switched_at === 'string' ? r.switched_at : '',
    reason: FALLBACK_REASONS.includes(r.reason as FallbackReason) ? (r.reason as FallbackReason) : 'error',
    retries_used: r.retries_used === 1 ? 1 : 0,
    events: Array.isArray(r.events) ? (r.events as FallbackEvent[]).slice(-8) : [],
  };
}

/** What readers must do with the rows of this run: is Recall's hidden standby transcript the visible one? */
export function recallIsVisible(state: FallbackState | null): boolean {
  return !!state && state.active && state.mode === 'recall';
}

/** The live stitcher must not save a partial live transcript as the final one when the live stream had an outage. */
export function liveTranscriptIsIncomplete(state: FallbackState | null): boolean {
  if (!state) return false;
  if (state.mode === 'unavailable') return true; // outage now, or one that was declared and later recovered (there is a gap)
  return false;
}

export type LiveStatus = 'ok' | 'unavailable' | 'recall_fallback';
export function liveStatusOf(state: FallbackState | null): LiveStatus {
  if (!state) return 'ok';
  if (state.mode === 'recall' && state.active) return 'recall_fallback';
  if (state.mode === 'unavailable' && state.active) return 'unavailable';
  return 'ok';
}

// ---------------------------------------------------------------------------------------------------------------------------
// Pure decisions

export function decideSilentWithStandby(o: { recallEndSec: number; recallWords: number; lastSonioxEndSec: number | null; cfg: FallbackConfig }): boolean {
  if (o.recallWords < o.cfg.minRecallWords) return false;
  return o.recallEndSec - (o.lastSonioxEndSec ?? 0) >= o.cfg.silenceSec;
}

export function decideNoSegments(o: { nowMs: number; inCallSinceMs: number | null; hasAnySonioxSegment: boolean; cfg: FallbackConfig }): boolean {
  if (o.hasAnySonioxSegment || o.inCallSinceMs === null) return false;
  return o.nowMs - o.inCallSinceMs >= o.cfg.noSegmentsSec * 1000;
}

export interface StreamEventInput { type: 'stream_degraded' | 'stream_fatal'; reason: FallbackReason }

// ---------------------------------------------------------------------------------------------------------------------------
// Database side

export interface LiveRun {
  id: string;
  meeting_id: string;
  user_id: string;
  live_stt_ref?: string | null;
  live_stt_provider?: string | null;
  live_stt_fallback?: unknown;
  joined_at?: string | null;
  created_at?: string | null;
}

let columnMissing = false;
/** Test hook. */
export function resetFallbackColumnFlag(): void { columnMissing = false; }
export function fallbackColumnIsMissing(): boolean { return columnMissing; }

function noteMissingColumn(): void {
  if (!columnMissing) {
    columnMissing = true;
    console.error('[LiveStt] bot_runs.live_stt_fallback is missing (migration 030 not applied): automatic fallback is unavailable');
    reportAlert('live_stt', 'LIVE_STT_FALLBACK_MIGRATION_MISSING', {}, 60 * 60_000);
  }
  inc('live_stt_fallback_unsupported');
}

/** Select a bot run tolerating a database without migration 030 (and 026). `by` = the filter column. */
export async function selectLiveRun(by: 'live_stt_ref' | 'recall_bot_id', value: string, extra = ''): Promise<{ data: (LiveRun & Record<string, unknown>) | null; error: boolean }> {
  const base = `id, meeting_id, user_id, live_stt_provider${extra ? `, ${extra}` : ''}`;
  const attempts = columnMissing
    ? [`${base}, joined_at`, base]
    : [`${base}, live_stt_fallback, joined_at`, `${base}, joined_at`, base];
  for (const cols of attempts) {
    const { data, error } = await supabaseAdmin.from('bot_runs').select(cols).eq(by, value).maybeSingle();
    if (!error) return { data: (data as unknown as LiveRun & Record<string, unknown>) ?? null, error: false };
    if (isMissingColumn(error, 'live_stt_fallback')) noteMissingColumn();
    else if (!isMissingColumn(error, 'joined_at') && !isMissingColumn(error, 'live_stt_provider')) return { data: null, error: true };
  }
  return { data: null, error: true };
}

async function writeState(runId: string, state: FallbackState): Promise<boolean> {
  const { error } = await supabaseAdmin.from('bot_runs').update({ live_stt_fallback: state }).eq('id', runId);
  if (error) {
    if (isMissingColumn(error, 'live_stt_fallback')) noteMissingColumn();
    else console.error('[LiveStt] could not save fallback state');
    return false;
  }
  return true;
}

async function lastVisibleSoniox(runId: string): Promise<{ endSec: number; createdAt: string | null } | null> {
  const { data } = await supabaseAdmin
    .from('live_transcripts')
    .select('end_timestamp, created_at')
    .eq('bot_run_id', runId)
    .eq('is_partial', false)
    .eq('shadow', false)
    .like('source_key', 'live:%')
    .order('end_timestamp', { ascending: false })
    .limit(1);
  const row = (data as Array<{ end_timestamp: number; created_at?: string }> | null)?.[0];
  return row ? { endSec: Number(row.end_timestamp) || 0, createdAt: row.created_at ?? null } : null;
}

/** True when this run has hidden Recall standby rows (so a Recall transcript is running next to Soniox). */
export async function hasStandbyRows(runId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('live_transcripts').select('id').eq('bot_run_id', runId).eq('shadow', true).is('source_key', null).limit(1);
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

function pushEvent(state: FallbackState | null, ev: FallbackEvent): FallbackEvent[] {
  return [...(state?.events ?? []), ev].slice(-8);
}

export type SwitchResult = 'switched' | 'already' | 'unsupported' | 'error';

/**
 * Declare the Soniox stream failed for this meeting. Idempotent (a second call while the outage is current is a no-op), safe to
 * run concurrently on two machines (both compute the same switch point and write the same state).
 */
export async function declareStreamFailure(
  run: LiveRun,
  reason: FallbackReason,
  opts: { standby: boolean; source: 'event' | 'watchdog' | 'recall_evidence'; queueInsights?: (meetingId: string, userId: string) => Promise<void> }
): Promise<SwitchResult> {
  if (columnMissing || !fallbackConfigFrom().enabled) return 'unsupported';
  const state = parseFallbackState(run.live_stt_fallback);
  if (state?.active) return 'already';
  const last = await lastVisibleSoniox(run.id);
  const at = last?.endSec ?? 0;
  const mode: FallbackMode = opts.standby ? 'recall' : 'unavailable';
  const now = new Date().toISOString();
  const next: FallbackState = {
    v: 1,
    active: true,
    mode,
    switched_at_sec: at,
    switched_at: now,
    reason,
    retries_used: state?.retries_used ?? 0,
    events: pushEvent(state, { t: now, kind: 'switch', reason, at_sec: at }),
  };
  if (!(await writeState(run.id, next))) return columnMissing ? 'unsupported' : 'error';

  if (mode === 'recall') {
    const { error } = await supabaseAdmin
      .from('live_transcripts')
      .update({ shadow: false })
      .eq('bot_run_id', run.id)
      .eq('shadow', true)
      .is('source_key', null)
      .gte('start_timestamp', at);
    if (error) console.error('[LiveStt] could not reveal the standby rows');
    if (opts.queueInsights) { try { await opts.queueInsights(run.meeting_id, run.user_id); } catch { /* insights are best effort */ } }
  }
  inc('live_stt_fallbacks', { mode, reason, source: opts.source });
  logEvent('fallback', { ref: refTag(run.live_stt_ref), mode, reason, source: opts.source, at_sec: Math.round(at) });
  return 'switched';
}

/** Segments arrived again after an outage was declared (default mode): return to ok once. Returns true when the state changed. */
export async function noteSegmentsResumed(run: LiveRun): Promise<boolean> {
  const state = parseFallbackState(run.live_stt_fallback);
  if (!state || !state.active || state.mode !== 'unavailable') return false;
  if (state.retries_used === 1) return false; // the one retry was already used: the meeting stays marked
  // A stream that was merely late to its first segment ('no_segments') does not spend the retry.
  const now = new Date().toISOString();
  const spent = state.reason === 'no_segments' ? 0 : 1;
  const next: FallbackState = { ...state, active: false, retries_used: spent as 0 | 1, events: pushEvent(state, { t: now, kind: 'recovered', reason: 'segments_resumed', at_sec: state.switched_at_sec }) };
  if (!(await writeState(run.id, next))) return false;
  inc('live_stt_recoveries', { reason: state.reason });
  logEvent('recovered', { ref: refTag(run.live_stt_ref), reason: state.reason });
  return true;
}

// Per-process throttle for the Recall-evidence check (state is in the database, so another machine may still check: harmless).
const lastCheck = new Map<string, number>();
const CHECK_EVERY_MS = 5000;

/**
 * Hot standby: a Recall final segment arrived. If its meeting time is far past the last Soniox segment, Soniox is silent while the
 * meeting is not. Returns true when the meeting switched.
 */
export async function checkRecallEvidence(
  run: LiveRun,
  seg: { endSec: number; words: number },
  deps: { nowMs?: number; cfg?: FallbackConfig; queueInsights?: (meetingId: string, userId: string) => Promise<void> } = {}
): Promise<boolean> {
  const cfg = deps.cfg ?? fallbackConfigFrom();
  const now = deps.nowMs ?? Date.now();
  if (!cfg.enabled || parseFallbackState(run.live_stt_fallback)?.active) return false;
  if (seg.words < cfg.minRecallWords) return false;
  if (now - (lastCheck.get(run.id) ?? 0) < CHECK_EVERY_MS) return false;
  if (lastCheck.size > 500) lastCheck.clear();
  lastCheck.set(run.id, now);
  const last = await lastVisibleSoniox(run.id);
  if (!decideSilentWithStandby({ recallEndSec: seg.endSec, recallWords: seg.words, lastSonioxEndSec: last?.endSec ?? null, cfg })) return false;
  const r = await declareStreamFailure(run, 'silent', { standby: true, source: 'recall_evidence', ...(deps.queueInsights ? { queueInsights: deps.queueInsights } : {}) });
  return r === 'switched';
}

/** Test hook. */
export function resetFallbackThrottle(): void { lastCheck.clear(); }

/**
 * An explicit report from the live-stt service. `stream_fatal` and `stream_degraded` both declare the failure now: the service only
 * sends degraded after its own bounded retry, and a fatal error (auth, bad config) cannot be retried.
 */
export async function handleStreamEvent(
  run: LiveRun,
  evt: StreamEventInput,
  deps: { queueInsights?: (meetingId: string, userId: string) => Promise<void> } = {}
): Promise<SwitchResult> {
  inc('live_stt_stream_events', { type: evt.type, reason: evt.reason });
  const standby = await hasStandbyRows(run.id);
  return declareStreamFailure(run, evt.reason, { standby, source: 'event', ...(deps.queueInsights ? { queueInsights: deps.queueInsights } : {}) });
}

/**
 * One watchdog pass (default mode): active Soniox bot runs whose bot has been in the call long enough and never produced a
 * segment are declared unavailable. Returns how many runs were declared.
 */
export async function sweepNoSegments(deps: { nowMs?: number; cfg?: FallbackConfig } = {}): Promise<number> {
  const cfg = deps.cfg ?? fallbackConfigFrom();
  if (columnMissing || !cfg.enabled) return 0;
  const now = deps.nowMs ?? Date.now();
  const since = new Date(now - 6 * 3600_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('bot_runs')
    .select('id, meeting_id, user_id, live_stt_ref, live_stt_provider, live_stt_fallback, joined_at, created_at')
    .eq('live_stt_provider', 'soniox')
    .in('status', ['in_call', 'recording'])
    .gte('created_at', since)
    .limit(200);
  if (error) {
    if (isMissingColumn(error, 'live_stt_fallback')) noteMissingColumn();
    return 0;
  }
  let declared = 0;
  for (const run of (data as LiveRun[] | null) ?? []) {
    if (parseFallbackState(run.live_stt_fallback)) continue;
    const joined = run.joined_at ? Date.parse(run.joined_at) : NaN;
    if (!Number.isFinite(joined)) continue;
    if (now - joined < cfg.noSegmentsSec * 1000) continue; // cheap check first
    const any = await lastVisibleSoniox(run.id);
    if (!decideNoSegments({ nowMs: now, inCallSinceMs: joined, hasAnySonioxSegment: !!any, cfg })) continue;
    if (await hasStandbyRows(run.id)) continue; // hot standby decides from Recall's evidence instead
    if ((await declareStreamFailure(run, 'no_segments', { standby: false, source: 'watchdog' })) === 'switched') declared += 1;
  }
  return declared;
}

let sweepTimer: NodeJS.Timeout | null = null;
export function startLiveSttWatchdogLoop(): void {
  if (sweepTimer) return;
  const cfg = fallbackConfigFrom();
  sweepTimer = setInterval(() => { sweepNoSegments().catch(() => console.error('[LiveStt] watchdog pass failed')); }, cfg.sweepSec * 1000);
  sweepTimer.unref?.();
}
export function stopLiveSttWatchdogLoop(): void { if (sweepTimer) clearInterval(sweepTimer); sweepTimer = null; }
