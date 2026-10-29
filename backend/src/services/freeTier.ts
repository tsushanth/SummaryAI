/**
 * Free tier rules, in one place.
 *
 * Since 2026-10-29 (phase 0 of the free-tier design) a free account can record or upload without a
 * recording-count limit and gets transcript, summary, key points, action items, regenerate, follow-up
 * email draft, share links and exports without a subscription. The paid tier is Q&A, cross-meeting
 * chat, the meeting bot, phone-call recording and calendar sync (those are gated in the clients; the
 * only server-side enforcement that ever existed was the recording count below).
 *
 * To restore the old behaviour (3 recordings, summaries for subscribers only) set the environment
 * variable FREE_TIER_LEGACY_LIMITS=true on the backend and restart. Nothing else needs to change:
 * the web app reads `features` from GET /api/subscriptions/status.
 *
 * Per-file limits (MAX_AUDIO_FILE_SIZE_MB, MAX_RECORDING_DURATION_SECONDS) are unchanged and are
 * enforced in the create-recording schema.
 */

import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';

/** Recordings a non-subscriber may create while the legacy limit is on. */
export const FREE_TIER_RECORDING_LIMIT = 3;

/**
 * Abuse backstop that replaces the old 3-recording cap: at most this many recordings may be created
 * per user per window (in-memory, per backend process). Far above any real use (a person recording
 * back-to-back meetings), low enough to stop a script from queueing hours of paid transcription.
 */
export const CREATE_RECORDING_WINDOW_MS = 60 * 60 * 1000;
export const CREATE_RECORDING_MAX_PER_WINDOW = 60;

export function legacyFreeLimitsEnabled(): boolean {
  return config.FREE_TIER_LEGACY_LIMITS === true;
}

export interface PlanFeatures {
  unlimitedRecordings: boolean;
  aiSummaries: boolean;
  qaChat: boolean;
  meetingBot: boolean;
  phoneRecording: boolean;
  calendarSync: boolean;
  exportPdf: boolean;
}

/** Feature flags returned by GET /api/subscriptions/status (the web app gates its UI on these). */
export function planFeatures(isSubscribed: boolean, legacy: boolean = legacyFreeLimitsEnabled()): PlanFeatures {
  const free = !legacy; // true = recording, summaries and exports are free for everyone
  return {
    unlimitedRecordings: free || isSubscribed,
    aiSummaries: free || isSubscribed,
    qaChat: isSubscribed,
    meetingBot: isSubscribed,
    phoneRecording: isSubscribed,
    calendarSync: isSubscribed,
    exportPdf: free || isSubscribed,
  };
}

/**
 * True when the legacy free-tier recording limit is on AND this user is over it.
 * Returns false immediately (no database reads) while the legacy limit is off.
 */
export async function isBlockedByLegacyRecordingLimit(userId: string, clientSaysSubscribed: boolean): Promise<boolean> {
  if (!legacyFreeLimitsEnabled()) return false;

  // Subscription sources: profiles (Stripe / RevenueCat webhooks), subscriptions table (Play RTDN),
  // and the client-provided header (Play Billing verified on device).
  let isSubscribed = false;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('subscription_status')
    .eq('id', userId)
    .single();
  if (profile?.subscription_status === 'active' || profile?.subscription_status === 'trialing') {
    isSubscribed = true;
  }

  if (!isSubscribed) {
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('status')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing'])
      .limit(1)
      .maybeSingle();
    if (sub) isSubscribed = true;
  }

  if (!isSubscribed && clientSaysSubscribed) isSubscribed = true;
  if (isSubscribed) return false;

  const { count } = await supabaseAdmin
    .from('recordings')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  return (count ?? 0) >= FREE_TIER_RECORDING_LIMIT;
}
