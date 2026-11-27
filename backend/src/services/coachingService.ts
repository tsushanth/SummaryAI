/**
 * Realtime Coaching Service — persona-based per-meeting AI coach.
 *
 * Distinct from `liveInsightsService` (which produces generic ambient
 * insights for all users). This service:
 *  - Is paid (consumes a credit when a session starts).
 *  - Runs faster cadence (every 30s vs ~5min) so tactical advice lands in time.
 *  - Uses persona-specific prompts (Sales Discovery, etc.).
 *  - Auto-refunds the credit if `insight_count < 3` at session end (no value).
 *  - Follows the meeting bot: it ends (and says why) when the bot fails, is not let in or leaves.
 *
 * See REALTIME_COACHING.md for the full design.
 */

import Anthropic from '@anthropic-ai/sdk';
import { instrumentAnthropic, withFeature } from '../lib/llm.js';
import { config } from '../config/index.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { reportAlert } from '../lib/alerts.js';
import { getPersona, personaSystemPrompt, CoachingPersona } from './coachingPersonas.js';
import { pickOutputLanguage } from '../lib/outputLanguage.js';
import { botEndReason, getMeetingBotState, BotEndReason } from './meetingBotState.js';

const REFUND_THRESHOLD_INSIGHTS = 3;
const TRANSCRIPT_TAIL_SEGMENTS = 30; // ~5min of typical meeting transcript

// In-memory registry of active session ticker timers.
const activeTimers = new Map<string, NodeJS.Timeout>();
// In-memory subscribers map: sessionId → array of SSE-style emit callbacks.
type EmitFn = (event: string, data: unknown) => void;
const subscribers = new Map<string, Set<EmitFn>>();
// Language the client asked for at session start (not persisted: after a restart the recording's output_language is used).
const sessionLanguages = new Map<string, string>();
// Per-session tick bookkeeping, in memory only: a restart costs at most one repeated model call.
const ticking = new Set<string>();
const lastTranscriptSent = new Map<string, string>();
const modelCalls = new Map<string, 'answered' | 'failed'>();

/** Why a session ended: the app or the user asked, the bot ended it, or it outlived SESSION_MAX_AGE_HOURS. */
export type EndReason = BotEndReason | 'client' | 'expired';
/** Why a session produced no tip at all. Stored in refund_reason after the colon, and alerted. */
export type NoInsightOutcome =
  | 'bot_not_admitted' | 'bot_failed' | 'bot_not_in_meeting' | 'no_speech' | 'ended_too_soon' | 'model_failed' | 'no_suggestions';
const REFUND_REASON = 'insight_count_below_threshold';

// ----- Public API -----

export class NoCreditsError extends Error {
  constructor() { super('No coaching credits available.'); }
}
export class InvalidPersonaError extends Error {
  constructor(key: string) { super(`Unknown persona: ${key}`); }
}
/** The meeting's bot is gone, so a session could never receive anything. No credit is taken. */
export class MeetingNotLiveError extends Error {
  constructor(readonly code: string | null, readonly endReason: BotEndReason) { super('The meeting bot is no longer in this meeting.'); }
}

/** The part of refund_reason that says why there were no tips, or null. */
export function noInsightOutcome(refundReason: string | null | undefined): NoInsightOutcome | null {
  const [base, outcome] = String(refundReason ?? '').split(':');
  return base === REFUND_REASON && outcome ? (outcome as NoInsightOutcome) : null;
}

/** Sum of unexpired credit balances for a user. */
export async function getCreditBalance(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('coaching_credits')
    .select('balance')
    .eq('user_id', userId)
    .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString());
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + (row.balance ?? 0), 0);
}

/** Grant N credits to a user. Idempotent via `sourceEventId`. */
export async function grantCredits(
  userId: string,
  amount: number,
  source: 'free' | 'iap' | 'subscription' | 'manual',
  opts: { productId?: string; sourceEventId?: string; expiresAt?: Date } = {}
): Promise<{ id: string; alreadyExisted: boolean } | null> {
  if (amount <= 0) return null;
  if (opts.sourceEventId) {
    const { data: existing } = await supabaseAdmin
      .from('coaching_credits')
      .select('id')
      .eq('source_event_id', opts.sourceEventId)
      .maybeSingle();
    if (existing) return { id: existing.id, alreadyExisted: true };
  }
  const { data, error } = await supabaseAdmin
    .from('coaching_credits')
    .insert({
      user_id: userId,
      source,
      product_id: opts.productId ?? null,
      balance: amount,
      expires_at: opts.expiresAt?.toISOString() ?? null,
      source_event_id: opts.sourceEventId ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id, alreadyExisted: false };
}

/**
 * Create a coaching session for a recording. Debits one credit (oldest first
 * among unexpired). Returns the session id. Throws NoCreditsError if the user
 * has no credits.
 */
export async function startSession(
  userId: string,
  recordingId: string,
  personaKey: string,
  outputLanguage?: string | null
): Promise<{ sessionId: string; resumed?: boolean }> {
  const persona = getPersona(personaKey);
  if (!persona) throw new InvalidPersonaError(personaKey);

  const { data: target } = await supabaseAdmin
    .from('recordings')
    .select('meeting_id')
    .eq('id', recordingId)
    .maybeSingle();
  if (target?.meeting_id) {
    const bot = await getMeetingBotState(target.meeting_id);
    const gone = bot && botEndReason(bot);
    if (bot && gone) {
      const stale = await openSessionId(userId, recordingId);
      if (stale) await endSession(stale, gone);
      throw new MeetingNotLiveError(bot.code, gone);
    }
  }
  // Asking again for a recording that already has an open session returns it: no second credit.
  const resume = (sessionId: string) => {
    startTicker(sessionId, persona);
    return { sessionId, resumed: true };
  };
  const existing = await openSessionId(userId, recordingId);
  if (existing) return resume(existing);

  // Pick the oldest non-empty unexpired credit row (FIFO consumption — free
  // credits go first, then earliest-purchased IAP).
  const nowIso = new Date().toISOString();
  const { data: credit } = await supabaseAdmin
    .from('coaching_credits')
    .select('id, balance')
    .eq('user_id', userId)
    .gt('balance', 0)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('granted_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!credit) throw new NoCreditsError();

  if (!(await changeCreditBalance(credit.id, -1))) throw new NoCreditsError();

  const { data: session, error } = await supabaseAdmin
    .from('coaching_sessions')
    .insert({
      recording_id: recordingId,
      user_id: userId,
      persona: personaKey,
      credit_id: credit.id,
    })
    .select('id')
    .single();
  if (error) {
    // Roll back the debit so the user doesn't lose a credit to a bad session row.
    await changeCreditBalance(credit.id, 1);
    // One open session per recording (unique index): a simultaneous request created it first.
    const other = (error as { code?: string }).code === '23505' ? await openSessionId(userId, recordingId) : null;
    if (other) return resume(other);
    throw error;
  }

  const language = pickOutputLanguage(outputLanguage);
  if (language) sessionLanguages.set(session.id, language);
  startTicker(session.id, persona);
  return { sessionId: session.id };
}

async function openSessionId(userId: string, recordingId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('coaching_sessions')
    .select('id')
    .eq('recording_id', recordingId)
    .eq('user_id', userId)
    .is('ended_at', null)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Adds `delta` to a credit row, writing only if the balance is still the one just read. Two requests working from the same
 * read must not both write: that loses a debit or repeats a refund. false = nothing changed.
 */
async function changeCreditBalance(creditId: string, delta: 1 | -1): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row, error: readError } = await supabaseAdmin
      .from('coaching_credits')
      .select('balance')
      .eq('id', creditId)
      .maybeSingle();
    if (readError) throw readError;
    if (!row || row.balance + delta < 0) return false;
    const { data: changed, error } = await supabaseAdmin
      .from('coaching_credits')
      .update({ balance: row.balance + delta })
      .eq('id', creditId)
      .eq('balance', row.balance)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (changed) return true;
  }
  return false;
}

/** End a session. Auto-refunds the credit if too few insights were emitted. */
export async function endSession(sessionId: string, reason: EndReason = 'client'): Promise<{ refunded: boolean }> {
  stopTicker(sessionId);

  // Close first, and only if still open: of repeated or simultaneous calls exactly one gets the row, so only one can refund.
  const { data: session, error: closeError } = await supabaseAdmin
    .from('coaching_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('ended_at', null)
    .select('id, credit_id, insight_count, recording_id, started_at')
    .maybeSingle();
  if (closeError) console.error(`[Coaching] could not end session ${sessionId}:`, closeError.message);
  if (!session) return { refunded: false };

  let refunded = false;
  if (session.insight_count < REFUND_THRESHOLD_INSIGHTS && session.credit_id) {
    // Auto-refund: bump the originating credit balance back up by 1.
    try {
      refunded = await changeCreditBalance(session.credit_id, 1);
    } catch (e) {
      console.error(`[Coaching] refund failed for session ${sessionId}:`, (e as { message?: string }).message);
    }
    if (!refunded) reportAlert('coaching', 'REFUND_FAILED');
  }

  // Every session that gave nothing is recorded with its reason and reported.
  let outcome: NoInsightOutcome | null = null;
  if (session.insight_count === 0) {
    outcome = await explainNoInsights(session, reason).catch(() => null);
    if (outcome) reportAlert('coaching', `NO_INSIGHTS_${outcome.toUpperCase()}`, { ended_by: reason, refunded });
  }
  console.log(`[Coaching] session ${sessionId} ended by ${reason}: ${session.insight_count} insights, refunded=${refunded}${outcome ? `, ${outcome}` : ''}`);

  if (refunded) {
    await supabaseAdmin
      .from('coaching_sessions')
      .update({ refunded: true, refund_reason: outcome ? `${REFUND_REASON}:${outcome}` : REFUND_REASON })
      .eq('id', sessionId);
  }

  subscribers.get(sessionId)?.forEach(emit => emit('ended', { reason: outcome ?? reason, refunded }));
  subscribers.delete(sessionId);
  sessionLanguages.delete(sessionId);
  lastTranscriptSent.delete(sessionId);
  modelCalls.delete(sessionId);
  return { refunded };
}

async function explainNoInsights(
  session: { id: string; recording_id: string; started_at: string },
  reason: EndReason
): Promise<NoInsightOutcome> {
  if (reason === 'bot_not_admitted' || reason === 'bot_failed') return reason;
  const call = modelCalls.get(session.id);
  if (call === 'failed') return 'model_failed';
  if (call === 'answered') return 'no_suggestions';
  const { data: recording } = await supabaseAdmin.from('recordings').select('meeting_id').eq('id', session.recording_id).maybeSingle();
  if (!recording?.meeting_id) return 'no_speech';
  const bot = await getMeetingBotState(recording.meeting_id);
  if (bot && (bot.state === 'joining' || bot.state === 'waiting_room')) return 'bot_not_in_meeting';
  const { data: spoken } = await supabaseAdmin
    .from('live_transcripts')
    .select('id')
    .eq('meeting_id', recording.meeting_id)
    .eq('is_partial', false)
    .eq('shadow', false)
    .limit(1);
  return spoken?.length ? 'ended_too_soon' : 'no_speech';
}

/** Ends the open sessions of a meeting whose bot has failed or left. Does nothing while the bot is still coming or there. */
export async function endSessionsIfBotGone(meetingId: string): Promise<void> {
  const bot = await getMeetingBotState(meetingId);
  const reason = bot && botEndReason(bot);
  if (!reason) return;
  const { data: recordings } = await supabaseAdmin.from('recordings').select('id').eq('meeting_id', meetingId);
  const ids = (recordings ?? []).map(r => r.id as string);
  if (!ids.length) return;
  const { data: open } = await supabaseAdmin.from('coaching_sessions').select('id').in('recording_id', ids).is('ended_at', null);
  for (const s of open ?? []) await endSession(s.id, reason);
}

/** The caller's most recent session on a recording, open or ended, for an app that lost track of it. */
export async function getLatestSession(userId: string, recordingId: string) {
  const { data } = await supabaseAdmin
    .from('coaching_sessions')
    .select('id, persona, started_at, ended_at, insight_count, refunded, refund_reason')
    .eq('recording_id', recordingId)
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Register a callback that receives new insights for this session via SSE-style emits. */
export function subscribe(sessionId: string, emit: EmitFn): () => void {
  if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set());
  subscribers.get(sessionId)!.add(emit);
  return () => subscribers.get(sessionId)?.delete(emit);
}

/** All insights emitted in this session — used by the post-meeting summary view. */
export async function getInsights(sessionId: string) {
  const { data } = await supabaseAdmin
    .from('coaching_insights')
    .select('*')
    .eq('session_id', sessionId)
    .order('emitted_at', { ascending: true });
  return data ?? [];
}

// ----- Internal ticker loop -----

function startTicker(sessionId: string, persona: CoachingPersona): void {
  if (activeTimers.has(sessionId)) return;
  const timer = setInterval(() => {
    tick(sessionId, persona).catch(err => {
      console.error(`[Coaching] tick error for ${sessionId}:`, err);
    });
  }, persona.cadenceSeconds * 1000);
  activeTimers.set(sessionId, timer);
}

function stopTicker(sessionId: string): void {
  const t = activeTimers.get(sessionId);
  if (t) { clearInterval(t); activeTimers.delete(sessionId); }
  sessionLanguages.delete(sessionId); // a stopped session never ticks again, so its language is not needed
}

async function tick(sessionId: string, persona: CoachingPersona): Promise<void> {
  if (ticking.has(sessionId)) return; // the previous model call is still running
  ticking.add(sessionId);
  try {
    await runTick(sessionId, persona);
  } catch (err) {
    reportAlert('coaching', 'TICK_FAILED', { code: (err as { status?: number; code?: string } | null)?.status ?? (err as { code?: string } | null)?.code });
    throw err;
  } finally {
    ticking.delete(sessionId);
  }
}

async function runTick(sessionId: string, persona: CoachingPersona): Promise<void> {
  console.log(`[Coaching] tick fired for session ${sessionId}`);

  // Bail if the session was ended out from under us.
  const { data: session } = await supabaseAdmin
    .from('coaching_sessions')
    .select('recording_id, ended_at, insight_count')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session || session.ended_at) {
    console.log(`[Coaching] tick: session ${sessionId} not found or ended, stopping`);
    stopTicker(sessionId);
    return;
  }

  // Pull recent transcript segments for this recording's live meeting.
  const { data: recording } = await supabaseAdmin
    .from('recordings')
    .select('meeting_id, output_language')
    .eq('id', session.recording_id)
    .maybeSingle();
  if (!recording?.meeting_id) {
    console.log(`[Coaching] tick: recording ${session.recording_id} has no meeting_id, skipping`);
    return;
  }

  // Backstop for a missed webhook or a reconciler closing the run: nothing more is coming, so stop and say why.
  const bot = await getMeetingBotState(recording.meeting_id);
  const gone = bot && botEndReason(bot);
  if (gone) {
    await endSession(sessionId, gone);
    return;
  }

  const { data: segments } = await supabaseAdmin
    .from('live_transcripts')
    .select('speaker_name, segment_text, end_timestamp, created_at')
    .eq('meeting_id', recording.meeting_id)
    .eq('is_partial', false)
    .eq('shadow', false)
    .order('created_at', { ascending: false })
    .limit(TRANSCRIPT_TAIL_SEGMENTS);
  if (!segments || segments.length === 0) {
    console.log(`[Coaching] tick: no transcript segments yet for meeting ${recording.meeting_id}, skipping`);
    return;
  }
  // Newest first here. Silence since the last answered call means there is nothing new to coach on.
  const newest = `${segments[0]!.created_at}|${segments[0]!.end_timestamp}|${segments[0]!.segment_text}`;
  if (lastTranscriptSent.get(sessionId) === newest) return;
  console.log(`[Coaching] tick: ${segments.length} transcript segments to feed`);

  const transcriptTail = segments
    .reverse()
    .map(s => `[${s.speaker_name || 'Speaker'}]: ${s.segment_text}`)
    .join('\n');

  // Avoid re-suggesting already-emitted insights.
  const { data: priorInsights } = await supabaseAdmin
    .from('coaching_insights')
    .select('text')
    .eq('session_id', sessionId)
    .order('emitted_at', { ascending: false })
    .limit(15);
  const priorBlock = (priorInsights ?? []).map(p => `- ${p.text}`).join('\n') || '(none yet)';

  const anthropic = instrumentAnthropic(new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }));
  modelCalls.set(sessionId, 'failed'); // until a readable answer arrives
  const resp = await withFeature('coaching', () => anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: [{
      type: 'text',
      text: personaSystemPrompt(
        persona,
        pickOutputLanguage(sessionLanguages.get(sessionId), (recording as { output_language?: string | null }).output_language)
      ),
      cache_control: { type: 'ephemeral' },
    }] as any,
    messages: [{
      role: 'user',
      content: `Transcript (most recent ~${persona.windowMinutes} min):\n${transcriptTail}\n\nAlready suggested earlier in this session:\n${priorBlock}\n\nReturn JSON only.`,
    }],
  }));

  const text = (resp.content[0] as any)?.text ?? '';
  let parsed: { insights: Array<{ type: string; text: string; urgency: string }> } | null = null;
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      parsed = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
    }
  } catch {
    console.log('[Coaching] JSON parse failed');
  }

  // The session may have ended (and been refunded) while the model was answering.
  const { data: still } = await supabaseAdmin.from('coaching_sessions').select('ended_at').eq('id', sessionId).maybeSingle();
  if (!still || still.ended_at) return;

  if (!parsed || !Array.isArray(parsed.insights)) {
    reportAlert('coaching', 'PARSE_FAILED', { stop_reason: (resp as { stop_reason?: string | null }).stop_reason });
    return;
  }
  modelCalls.set(sessionId, 'answered');
  lastTranscriptSent.set(sessionId, newest);
  const insights = parsed.insights;
  console.log(`[Coaching] parsed ${insights.length} insights`);
  if (!insights.length) return;

  const lastSegment = segments[segments.length - 1];
  const offset = Math.floor(lastSegment?.end_timestamp ?? 0);

  // Insert, count, then emit, one tip at a time. The count drives the end-of-session auto-refund, so it must be exactly the
  // tips delivered: no rejected or failed rows, and never behind what the user has already been shown.
  const countBefore: number = session.insight_count;
  let persisted = 0;
  for (const i of insights) {
    if (!isValidInsight(i)) continue;
    const { data, error } = await supabaseAdmin
      .from('coaching_insights')
      .insert({
        session_id: sessionId,
        type: i.type,
        text: i.text,
        urgency: i.urgency,
        transcript_offset_seconds: offset,
      })
      .select('*')
      .single();
    if (error || !data) {
      // Never silent: a failing insert (grant/RLS change, constraint, outage) used to leave zero rows and no log line.
      console.error(`[Coaching] insight insert failed for session ${sessionId}:`, error ?? 'no row returned');
      reportAlert('coaching', 'INSIGHT_INSERT_FAILED', { code: (error as { code?: string } | null)?.code });
      continue;
    }
    // Counted only while the session is open. Ending it closes the same row and reads the count in one write, so a tip is
    // either counted before the refund decision or not delivered at all.
    const { data: counted, error: countError } = await supabaseAdmin
      .from('coaching_sessions')
      .update({ insight_count: countBefore + persisted + 1 })
      .eq('id', sessionId)
      .is('ended_at', null)
      .select('id')
      .maybeSingle();
    if (!counted) {
      await supabaseAdmin.from('coaching_insights').delete().eq('id', data.id);
      if (!countError) break; // ended meanwhile
      console.error(`[Coaching] could not count an insight for session ${sessionId}:`, countError.message);
      reportAlert('coaching', 'INSIGHT_COUNT_FAILED', { code: countError.code });
      continue;
    }
    persisted++;
    const subs = subscribers.get(sessionId);
    subs?.forEach(emit => emit('insight', data));
  }
  console.log(`[Coaching] persisted ${persisted}/${insights.length} insights for session ${sessionId}`);
}

function isValidInsight(i: any): i is { type: string; text: string; urgency: string } {
  return i && typeof i.text === 'string' && i.text.length > 0 && i.text.length <= 240
    && ['question', 'objection', 'signal', 'gap'].includes(i.type)
    && ['now', 'soon', 'before-end'].includes(i.urgency);
}

// ----- Recovery loop -----
//
// In-memory `activeTimers` doesn't survive process restarts (Fly deploys,
// machine wakes, etc). On boot, find any in-flight coaching sessions and
// re-attach a ticker so they don't go dark mid-meeting.

const SESSION_MAX_AGE_HOURS = 4;

export async function recoverActiveSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_MAX_AGE_HOURS * 3600_000).toISOString();
  const { data: rows, error } = await supabaseAdmin
    .from('coaching_sessions')
    .select('id, persona, started_at')
    .is('ended_at', null)
    .gt('started_at', cutoff);

  if (error) {
    console.error('[Coaching] recovery query failed:', error);
    return;
  }
  for (const r of rows ?? []) {
    const persona = getPersona(r.persona);
    if (!persona) continue;
    if (activeTimers.has(r.id)) continue; // already ticking on this machine
    console.log(`[Coaching] recovering ticker for session ${r.id} (persona=${r.persona})`);
    startTicker(r.id, persona);
  }
}

// Also auto-close sessions that have been open >4 hours so they don't tick
// forever. Runs every 5 min.
setInterval(async () => {
  const cutoff = new Date(Date.now() - SESSION_MAX_AGE_HOURS * 3600_000).toISOString();
  const { data: stale } = await supabaseAdmin
    .from('coaching_sessions')
    .select('id')
    .is('ended_at', null)
    .lt('started_at', cutoff);
  for (const s of stale ?? []) {
    console.log(`[Coaching] auto-closing stale session ${s.id}`);
    await endSession(s.id, 'expired');
  }
}, 5 * 60 * 1000).unref();
