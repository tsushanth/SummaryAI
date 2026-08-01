/**
 * Realtime Coaching Service — persona-based per-meeting AI coach.
 *
 * Distinct from `liveInsightsService` (which produces generic ambient
 * insights for all users). This service:
 *  - Is paid (consumes a credit when a session starts).
 *  - Runs faster cadence (every 30s vs ~5min) so tactical advice lands in time.
 *  - Uses persona-specific prompts (Sales Discovery, etc.).
 *  - Auto-refunds the credit if `insight_count < 3` at session end (no value).
 *
 * See REALTIME_COACHING.md for the full design.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { getPersona, CoachingPersona } from './coachingPersonas.js';

const REFUND_THRESHOLD_INSIGHTS = 3;
const TRANSCRIPT_TAIL_SEGMENTS = 30; // ~5min of typical meeting transcript

// In-memory registry of active session ticker timers.
const activeTimers = new Map<string, NodeJS.Timeout>();
// In-memory subscribers map: sessionId → array of SSE-style emit callbacks.
type EmitFn = (event: string, data: unknown) => void;
const subscribers = new Map<string, Set<EmitFn>>();

// ----- Public API -----

export class NoCreditsError extends Error {
  constructor() { super('No coaching credits available.'); }
}
export class InvalidPersonaError extends Error {
  constructor(key: string) { super(`Unknown persona: ${key}`); }
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
  personaKey: string
): Promise<{ sessionId: string }> {
  const persona = getPersona(personaKey);
  if (!persona) throw new InvalidPersonaError(personaKey);

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

  // Atomically decrement the credit balance. Optimistic check: we read
  // balance>0 above; if a parallel session-start already grabbed the last
  // credit, the update affects zero rows and we retry/fail.
  const { data: debited, error: debitErr } = await supabaseAdmin
    .from('coaching_credits')
    .update({ balance: credit.balance - 1 })
    .eq('id', credit.id)
    .gt('balance', 0)
    .select('id')
    .maybeSingle();
  if (debitErr) throw debitErr;
  if (!debited) throw new NoCreditsError();

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
    await supabaseAdmin
      .from('coaching_credits')
      .update({ balance: credit.balance })
      .eq('id', credit.id);
    throw error;
  }

  startTicker(session.id, persona);
  return { sessionId: session.id };
}

/** End a session. Auto-refunds the credit if too few insights were emitted. */
export async function endSession(sessionId: string): Promise<{ refunded: boolean }> {
  stopTicker(sessionId);

  const { data: session } = await supabaseAdmin
    .from('coaching_sessions')
    .select('id, credit_id, insight_count, ended_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session || session.ended_at) return { refunded: false };

  let refunded = false;
  if (session.insight_count < REFUND_THRESHOLD_INSIGHTS && session.credit_id) {
    // Auto-refund: bump the originating credit balance back up by 1.
    const { data: credit } = await supabaseAdmin
      .from('coaching_credits')
      .select('balance')
      .eq('id', session.credit_id)
      .maybeSingle();
    if (credit) {
      await supabaseAdmin
        .from('coaching_credits')
        .update({ balance: credit.balance + 1 })
        .eq('id', session.credit_id);
      refunded = true;
    }
  }

  await supabaseAdmin
    .from('coaching_sessions')
    .update({
      ended_at: new Date().toISOString(),
      refunded,
      refund_reason: refunded ? 'insight_count_below_threshold' : null,
    })
    .eq('id', sessionId);

  subscribers.delete(sessionId);
  return { refunded };
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
}

async function tick(sessionId: string, persona: CoachingPersona): Promise<void> {
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
    .select('meeting_id')
    .eq('id', session.recording_id)
    .maybeSingle();
  if (!recording?.meeting_id) {
    console.log(`[Coaching] tick: recording ${session.recording_id} has no meeting_id, skipping`);
    return;
  }

  const { data: segments } = await supabaseAdmin
    .from('live_transcripts')
    .select('speaker_name, segment_text, end_timestamp')
    .eq('meeting_id', recording.meeting_id)
    .eq('is_partial', false)
    .order('created_at', { ascending: false })
    .limit(TRANSCRIPT_TAIL_SEGMENTS);
  if (!segments || segments.length === 0) {
    console.log(`[Coaching] tick: no transcript segments yet for meeting ${recording.meeting_id}, skipping`);
    return;
  }
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

  const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: [{
      type: 'text',
      text: persona.system,
      cache_control: { type: 'ephemeral' },
    }] as any,
    messages: [{
      role: 'user',
      content: `Transcript (most recent ~${persona.windowMinutes} min):\n${transcriptTail}\n\nAlready suggested earlier in this session:\n${priorBlock}\n\nReturn JSON only.`,
    }],
  });

  const text = (resp.content[0] as any)?.text ?? '';
  console.log(`[Coaching] Claude raw: ${text.substring(0, 200)}`);
  let parsed: { insights: Array<{ type: string; text: string; urgency: string }> } | null = null;
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      parsed = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
    }
  } catch (e) {
    console.log(`[Coaching] JSON parse failed: ${(e as Error).message}`);
  }

  const insights = parsed?.insights ?? [];
  console.log(`[Coaching] parsed ${insights.length} insights`);
  if (!insights.length) return;

  const lastSegment = segments[segments.length - 1];
  const offset = Math.floor(lastSegment?.end_timestamp ?? 0);

  // Insert + emit
  for (const i of insights) {
    if (!isValidInsight(i)) continue;
    const { data } = await supabaseAdmin
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
    if (data) {
      const subs = subscribers.get(sessionId);
      subs?.forEach(emit => emit('insight', data));
    }
  }

  // Bump insight_count
  await supabaseAdmin
    .from('coaching_sessions')
    .update({ insight_count: session.insight_count + insights.length })
    .eq('id', sessionId);
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
    await endSession(s.id);
  }
}, 5 * 60 * 1000);
