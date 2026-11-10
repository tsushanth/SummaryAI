/**
 * Monthly meeting-bot allowance.
 *
 * Bot time is a metered resource, so a user may only have the bot in meetings for BOT_FREE_MONTHLY_CAP_MINUTES per calendar month
 * (UTC). The check runs BEFORE a bot is created (see the three RecallService.createBot call sites in routes/meetings.ts) and, when
 * the user is under the cap, also yields a per-session time limit so one long meeting cannot run far past what is left.
 *
 * What counts as used: bot_runs rows of the user whose bot actually JOINED the call (joined_at set) during the current UTC month.
 * Minutes are joined_at -> left_at (the time in the call). bot_runs.duration_seconds is NOT used when both timestamps exist: for
 * bot recordings it is estimated from the downloaded file size and can be far off. Fallbacks, in order:
 *   - joined, still in the call (no left_at, status in_call/recording): elapsed time so far, but only while younger than the session
 *     ceiling; an older row with no left_at is a stale row (lost webhook) and is not charged to the user.
 *   - joined, no left_at, not in the call any more: duration_seconds if present, else 0.
 * A run is attributed to the month it joined in (a call that spans midnight on the 1st is not split). Runs that never joined
 * (waiting room timeout, failed to start) count as zero. No schema change: everything comes from existing columns.
 *
 * Who is exempt: user ids in BOT_CAP_EXEMPT_USER_IDS, and users with a paid entitlement recorded on the server
 * (profiles.subscription_status active/trialing and not past subscription_expires_at). The client-supplied "I am subscribed" header
 * is deliberately NOT trusted here: it is trivially spoofable and would defeat the cap.
 *
 * Failure policy: FAIL OPEN. If the usage lookup throws or returns an error, the bot is allowed and the failure is logged loudly
 * (and raised as an alert); a database problem on our side must not stop users from recording a meeting that is already in progress.
 * Bad configuration fails SAFE: a missing, zero, negative or non-numeric cap falls back to the default, never to "unlimited".
 */

import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { reportAlert } from '../lib/alerts.js';
import { parseSecretList } from '../lib/liveStt.js';
import { AppError } from '../middleware/errorHandler.js';

export const BOT_CAP_ERROR_CODE = 'BOT_MONTHLY_CAP_REACHED';
export const DEFAULT_BOT_MONTHLY_CAP_MINUTES = 120;
/** Longest single bot session, in minutes, unless BOT_MAX_SESSION_MINUTES says otherwise. */
export const DEFAULT_BOT_MAX_SESSION_MINUTES = 240;
/** A session limit is never shorter than this, so a user with a minute left still gets a usable recording. */
export const MIN_BOT_SESSION_MINUTES = 5;
/** PostgREST returns at most this many rows per request. Hitting it is treated as "cap reached". */
export const USAGE_ROW_LIMIT = 1000;

/** Accepts a positive whole number only. Anything else (unset, '', 0, -5, 'abc', '12.5', '1e3') returns the default. */
export function parsePositiveMinutes(raw: string | undefined, fallback: number): number {
  const v = (raw ?? '').trim();
  if (!/^\d{1,7}$/.test(v)) return fallback;
  const n = Number(v);
  return n >= 1 ? n : fallback;
}

export function botMonthlyCapMinutes(): number {
  return parsePositiveMinutes(config.BOT_FREE_MONTHLY_CAP_MINUTES, DEFAULT_BOT_MONTHLY_CAP_MINUTES);
}

export function botMaxSessionMinutes(): number {
  return parsePositiveMinutes(config.BOT_MAX_SESSION_MINUTES, DEFAULT_BOT_MAX_SESSION_MINUTES);
}

export function isBotCapExempt(userId: string): boolean {
  const id = userId.trim().toLowerCase();
  return !!id && parseSecretList(config.BOT_CAP_EXEMPT_USER_IDS).some((a) => a.toLowerCase() === id);
}

/** [start of this UTC month, start of next UTC month). The second value is also the date the allowance resets. */
export function utcMonthWindow(now: Date): { start: Date; next: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    next: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export interface BotRunUsageRow {
  status?: string | null;
  joined_at?: string | null;
  left_at?: string | null;
  duration_seconds?: number | null;
}

const IN_CALL_STATUSES = ['in_call', 'recording'];

/**
 * Seconds of bot time one run is charged for. See the file header for the rules. This is the single usage computation: the
 * live-stt spend/hours guardrails (lib/liveSttAdmission.ts) call it too.
 * `staleCharge` decides what an in-call run older than the ceiling (a lost webhook) costs: 'none' (default, used for the user's
 * allowance: never bill a user for our missing webhook) or 'ceiling' (spend estimates: assume the worst, charge the ceiling).
 */
export function runSeconds(
  row: BotRunUsageRow,
  now: Date,
  ceilingMinutes: number,
  staleCharge: 'none' | 'ceiling' = 'none'
): number {
  if (!row.joined_at) return 0;
  const joined = Date.parse(row.joined_at);
  if (!Number.isFinite(joined)) return 0;
  const fallback = row.duration_seconds && row.duration_seconds > 0 ? row.duration_seconds : 0;
  if (row.left_at) {
    const left = Date.parse(row.left_at);
    if (Number.isFinite(left) && left >= joined) return (left - joined) / 1000;
    return fallback;
  }
  if (row.status && IN_CALL_STATUSES.includes(row.status)) {
    const elapsed = (now.getTime() - joined) / 1000;
    if (elapsed >= 0 && elapsed <= ceilingMinutes * 60) return elapsed;
    if (elapsed > ceilingMinutes * 60 && staleCharge === 'ceiling') return ceilingMinutes * 60;
  }
  return fallback;
}

export interface BotCapDecision {
  allowed: boolean;
  reason: 'under_cap' | 'cap_reached' | 'exempt_allowlist' | 'paid' | 'lookup_failed';
  capMinutes: number;
  usedMinutes: number | null;
  remainingMinutes: number | null;
  /** ISO timestamp (start of next UTC month) when the allowance resets. */
  resetsAt: string;
  /** Longest this session may run, in seconds. Undefined = no limit to send (exempt, paid, lookup failed, or limit switched off). */
  maxSessionSeconds?: number;
}

async function hasPaidEntitlement(userId: string, now: Date): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('subscription_status, subscription_expires_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`profiles lookup failed: ${error.message ?? error.code ?? 'unknown'}`);
  const p = data as { subscription_status?: string | null; subscription_expires_at?: string | null } | null;
  if (p?.subscription_status !== 'active' && p?.subscription_status !== 'trialing') return false;
  if (p.subscription_expires_at && Date.parse(p.subscription_expires_at) < now.getTime()) return false;
  return true;
}

async function usedSecondsThisMonth(userId: string, now: Date, ceilingMinutes: number): Promise<{ seconds: number; truncated: boolean }> {
  const { start, next } = utcMonthWindow(now);
  const { data, error } = await supabaseAdmin
    .from('bot_runs')
    .select('status, joined_at, left_at, duration_seconds')
    .eq('user_id', userId)
    .gte('joined_at', start.toISOString())
    .lt('joined_at', next.toISOString())
    .limit(USAGE_ROW_LIMIT);
  if (error) throw new Error(`bot_runs lookup failed: ${error.message ?? error.code ?? 'unknown'}`);
  const rows = (data ?? []) as BotRunUsageRow[];
  let seconds = 0;
  for (const r of rows) seconds += runSeconds(r, now, ceilingMinutes);
  return { seconds, truncated: rows.length >= USAGE_ROW_LIMIT };
}

/** Decide whether `userId` may start a bot now. Never throws: a lookup failure fails open (see the file header). */
export async function checkBotMonthlyCap(userId: string, now: Date = new Date()): Promise<BotCapDecision> {
  const capMinutes = botMonthlyCapMinutes();
  const ceilingMinutes = botMaxSessionMinutes();
  const resetsAt = utcMonthWindow(now).next.toISOString();
  const base = { capMinutes, resetsAt };

  if (isBotCapExempt(userId)) {
    return { ...base, allowed: true, reason: 'exempt_allowlist', usedMinutes: null, remainingMinutes: null };
  }

  try {
    const { seconds, truncated } = await usedSecondsThisMonth(userId, now, ceilingMinutes);
    const usedMinutes = truncated ? Math.max(capMinutes, Math.floor(seconds / 60)) : Math.floor(seconds / 60);
    const remainingMinutes = Math.max(0, capMinutes - usedMinutes);

    if (usedMinutes >= capMinutes) {
      // Over the allowance: a paid entitlement still lifts the cap.
      if (await hasPaidEntitlement(userId, now)) {
        return { ...base, allowed: true, reason: 'paid', usedMinutes, remainingMinutes: null };
      }
      return { ...base, allowed: false, reason: 'cap_reached', usedMinutes, remainingMinutes: 0 };
    }

    if ((config.BOT_SESSION_LIMIT ?? '').trim().toLowerCase() === 'off') {
      return { ...base, allowed: true, reason: 'under_cap', usedMinutes, remainingMinutes };
    }
    // Under the cap: the session may run for what is left (never shorter than the floor, never longer than the ceiling).
    // A paid user is not limited to the remainder.
    if (await hasPaidEntitlement(userId, now)) {
      return { ...base, allowed: true, reason: 'paid', usedMinutes, remainingMinutes: null };
    }
    const sessionMinutes = Math.min(ceilingMinutes, Math.max(remainingMinutes, MIN_BOT_SESSION_MINUTES));
    return { ...base, allowed: true, reason: 'under_cap', usedMinutes, remainingMinutes, maxSessionSeconds: sessionMinutes * 60 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[BotCap] FAIL OPEN: usage lookup failed for user ${userId}, allowing the bot: ${message}`);
    reportAlert('bot_cap', 'BOT_CAP_LOOKUP_FAILED', { message }, 60 * 60_000);
    return { ...base, allowed: true, reason: 'lookup_failed', usedMinutes: null, remainingMinutes: null };
  }
}

export function botCapError(d: BotCapDecision): AppError {
  const resetDate = d.resetsAt.slice(0, 10);
  return new AppError(
    403,
    BOT_CAP_ERROR_CODE,
    `You have used your ${d.capMinutes} free meeting-bot minutes for this month. The bot is available again on ${resetDate} (UTC). Recording a meeting yourself still works.`,
    {
      cap_minutes: String(d.capMinutes),
      used_minutes: String(d.usedMinutes ?? d.capMinutes),
      remaining_minutes: '0',
      resets_at: d.resetsAt,
    }
  );
}

/**
 * Call right before RecallService.createBot. Throws the BOT_MONTHLY_CAP_REACHED AppError when the user is over the cap; otherwise
 * returns the options to pass to createBot (a session time limit when one applies).
 */
export async function enforceBotMonthlyCap(userId: string, now: Date = new Date()): Promise<{ maxDurationSeconds?: number }> {
  const d = await checkBotMonthlyCap(userId, now);
  if (!d.allowed) {
    console.warn(`[BotCap] user ${userId} blocked: used ${d.usedMinutes}/${d.capMinutes} minutes, resets ${d.resetsAt}`);
    throw botCapError(d);
  }
  return d.maxSessionSeconds ? { maxDurationSeconds: d.maxSessionSeconds } : {};
}
