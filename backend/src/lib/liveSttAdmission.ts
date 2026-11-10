/**
 * Admission checks that run when a meeting bot is created (RecallService.createBot). All of them are OFF unless their environment
 * variable is set, so with nothing configured nothing here runs and no query is made. See backend/LIVE_STT.md ("Guardrails").
 *
 *  1. Capacity (only when a user is selected for Soniox): the live-stt service has ONE machine with a cap of MAX_SONIOX_STREAMS
 *     (3) concurrent streams, inside a Soniox org limit of 10 shared with other products. A 4th concurrent meeting would have no
 *     live transcript at all, so it is created as an ordinary Recall-transcript bot instead.
 *       LIVE_STT_MAX_CONCURRENT   default 3 (keep equal to the service's MAX_SONIOX_STREAMS)
 *  2. Spend and hours guardrails (cost model: 0.50 USD per bot hour, +0.12 Soniox, +0.15 if Recall's transcript is on):
 *       LIVE_STT_DAILY_WARN_USD         log + counter above this estimated spend today (UTC)
 *       LIVE_STT_DAILY_BLOCK_USD        refuse new bots above it                       
 *       LIVE_STT_MONTHLY_BLOCK_USD      refuse new bots above this month's estimate     
 *       LIVE_STT_USER_HOURS_WARN        log + counter when one user passes this many bot hours this month
 *       LIVE_STT_USER_HOURS_BLOCK       refuse new bots for that user                                    
 *     These count ALL bots (any provider), because the bot hour is 80% of the bill. They are estimates from bot_runs, not an invoice.
 *     Lookup failures fail OPEN (the bot is created) with an alert: a database problem on our side must not stop recording.
 *     Overlaps with the monthly allowance in PR #61 (BOT_FREE_MONTHLY_CAP_MINUTES); unify after it merges.
 */
import { supabaseAdmin } from './supabase.js';
import { reportAlert } from './alerts.js';
import { AppError } from '../middleware/errorHandler.js';
import { inc, logEvent } from './liveSttMetrics.js';

export const BOT_HOUR_USD = 0.5;
export const SONIOX_HOUR_USD = 0.12;
export const RECALL_TRANSCRIPT_HOUR_USD = 0.15;
const STALE_HOURS = 6; // Soniox streams are capped at 5 h; a run older than this that still says active is stale
const ACTIVE = ['joining', 'in_call', 'recording'];

export interface AdmissionConfig {
  maxConcurrent: number;
  dailyWarnUsd: number | null;
  dailyBlockUsd: number | null;
  monthlyBlockUsd: number | null;
  userHoursWarn: number | null;
  userHoursBlock: number | null;
  /** Used to price runs whose provider is 'soniox': does this deployment run Recall's transcript next to Soniox? */
  hotStandby: boolean;
}

function posOrNull(v: string | undefined): number | null {
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function admissionConfigFrom(env: Record<string, string | undefined> = process.env): AdmissionConfig {
  const mc = Number(env.LIVE_STT_MAX_CONCURRENT);
  return {
    maxConcurrent: Number.isFinite(mc) && mc >= 1 ? Math.floor(mc) : 3,
    dailyWarnUsd: posOrNull(env.LIVE_STT_DAILY_WARN_USD),
    dailyBlockUsd: posOrNull(env.LIVE_STT_DAILY_BLOCK_USD),
    monthlyBlockUsd: posOrNull(env.LIVE_STT_MONTHLY_BLOCK_USD),
    userHoursWarn: posOrNull(env.LIVE_STT_USER_HOURS_WARN),
    userHoursBlock: posOrNull(env.LIVE_STT_USER_HOURS_BLOCK),
    hotStandby: ['true', 'on', '1', 'yes'].includes((env.LIVE_STT_RECALL_HOT_STANDBY ?? '').trim().toLowerCase()),
  };
}

export function guardrailsEnabled(c: AdmissionConfig): boolean {
  return [c.dailyWarnUsd, c.dailyBlockUsd, c.monthlyBlockUsd, c.userHoursWarn, c.userHoursBlock].some((v) => v !== null);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Capacity

/** Concurrent Soniox-primary bots right now (joining, in call or recording; ignores runs older than 6 h as stale). */
export async function countActiveSonioxRuns(nowMs = Date.now()): Promise<number | null> {
  const since = new Date(nowMs - STALE_HOURS * 3600_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('bot_runs')
    .select('id')
    .eq('live_stt_provider', 'soniox')
    .in('status', ACTIVE)
    .gte('created_at', since)
    .limit(100);
  if (error) return null;
  return (data as unknown[] | null)?.length ?? 0;
}

/**
 * Is there room for one more Soniox stream? A failed count answers NO: a Recall-transcript bot is the safe choice (it always has a
 * live transcript), and the cost of being wrong is the 0.15 USD per hour transcription line for one meeting.
 */
export async function sonioxHasCapacity(cfg: AdmissionConfig = admissionConfigFrom(), nowMs = Date.now()): Promise<{ ok: boolean; active: number | null }> {
  const active = await countActiveSonioxRuns(nowMs);
  if (active === null) {
    inc('live_stt_capacity_check_failed');
    return { ok: false, active: null };
  }
  return { ok: active < cfg.maxConcurrent, active };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Spend and hours

interface RunRow {
  user_id: string;
  status: string;
  live_stt_provider: string | null;
  duration_seconds: number | null;
  joined_at: string | null;
  left_at: string | null;
  created_at: string;
}

/** Hours a run has used: joined..left span, else elapsed time if still in the call, else duration_seconds, else 0. */
export function runHours(r: Pick<RunRow, 'status' | 'duration_seconds' | 'joined_at' | 'left_at'>, nowMs: number): number {
  const j = r.joined_at ? Date.parse(r.joined_at) : NaN;
  const l = r.left_at ? Date.parse(r.left_at) : NaN;
  if (Number.isFinite(j) && Number.isFinite(l) && l >= j) return (l - j) / 3_600_000;
  if (Number.isFinite(j) && ACTIVE.includes(r.status)) return Math.min(STALE_HOURS, Math.max(0, (nowMs - j) / 3_600_000));
  return r.duration_seconds && r.duration_seconds > 0 ? r.duration_seconds / 3600 : 0;
}

export function runCostUsd(hours: number, provider: string | null, hotStandby: boolean): number {
  const rate = BOT_HOUR_USD + (provider === 'soniox' ? SONIOX_HOUR_USD + (hotStandby ? RECALL_TRANSCRIPT_HOUR_USD : 0)
    : provider === 'shadow' ? SONIOX_HOUR_USD + RECALL_TRANSCRIPT_HOUR_USD
    : RECALL_TRANSCRIPT_HOUR_USD);
  return hours * rate;
}

export interface Usage { dayUsd: number; monthUsd: number; userMonthHours: number }

export function summarizeUsage(rows: RunRow[], userId: string, nowMs: number, hotStandby: boolean): Usage {
  const dayStart = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate());
  let dayUsd = 0, monthUsd = 0, userMonthHours = 0;
  for (const r of rows) {
    const h = runHours(r, nowMs);
    const c = runCostUsd(h, r.live_stt_provider, hotStandby);
    monthUsd += c;
    if (Date.parse(r.created_at) >= dayStart) dayUsd += c;
    if (r.user_id === userId) userMonthHours += h;
  }
  return { dayUsd, monthUsd, userMonthHours };
}

export type AdmissionCode = 'BOT_DAILY_BUDGET_REACHED' | 'BOT_MONTHLY_BUDGET_REACHED' | 'BOT_USER_HOURS_REACHED';
export interface Admission { ok: boolean; code?: AdmissionCode; usage?: Usage }

export async function checkAdmission(userId: string | undefined, cfg: AdmissionConfig = admissionConfigFrom(), nowMs = Date.now()): Promise<Admission> {
  if (!guardrailsEnabled(cfg)) return { ok: true };
  try {
    const d = new Date(nowMs);
    const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
    const { data, error } = await supabaseAdmin
      .from('bot_runs')
      .select('user_id, status, live_stt_provider, duration_seconds, joined_at, left_at, created_at')
      .gte('created_at', monthStart)
      .limit(5000);
    if (error) throw new Error('lookup failed');
    const usage = summarizeUsage((data as RunRow[] | null) ?? [], userId ?? '', nowMs, cfg.hotStandby);

    if (cfg.dailyWarnUsd !== null && usage.dayUsd >= cfg.dailyWarnUsd) { inc('live_stt_guard_warn', { kind: 'daily' }); logEvent('guard_warn', { kind: 'daily', usd: Math.round(usage.dayUsd * 100) / 100 }); }
    if (cfg.userHoursWarn !== null && usage.userMonthHours >= cfg.userHoursWarn) { inc('live_stt_guard_warn', { kind: 'user_hours' }); logEvent('guard_warn', { kind: 'user_hours', hours: Math.round(usage.userMonthHours * 10) / 10 }); }

    let code: AdmissionCode | undefined;
    if (cfg.dailyBlockUsd !== null && usage.dayUsd >= cfg.dailyBlockUsd) code = 'BOT_DAILY_BUDGET_REACHED';
    else if (cfg.monthlyBlockUsd !== null && usage.monthUsd >= cfg.monthlyBlockUsd) code = 'BOT_MONTHLY_BUDGET_REACHED';
    else if (cfg.userHoursBlock !== null && userId && usage.userMonthHours >= cfg.userHoursBlock) code = 'BOT_USER_HOURS_REACHED';
    if (code) {
      inc('live_stt_guard_blocked', { code });
      logEvent('guard_blocked', { code });
      reportAlert('live_stt', `GUARD_${code}`, {}, 60 * 60_000);
      return { ok: false, code, usage };
    }
    return { ok: true, usage };
  } catch {
    inc('live_stt_guard_lookup_failed');
    console.error('[LiveStt] FAIL OPEN: guardrail lookup failed, bot allowed');
    reportAlert('live_stt', 'GUARD_LOOKUP_FAILED', {}, 60 * 60_000);
    return { ok: true };
  }
}

/** Throws the AppError the routes already know how to render. */
export async function assertAdmitted(userId: string | undefined, cfg?: AdmissionConfig): Promise<void> {
  const r = await checkAdmission(userId, cfg);
  if (r.ok) return;
  if (r.code === 'BOT_USER_HOURS_REACHED') {
    throw new AppError(403, r.code, 'You have used this month\'s meeting bot hours.');
  }
  throw new AppError(503, r.code!, 'New meeting bots are paused for now. Please try again later.');
}
