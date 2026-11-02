/**
 * Free tier rules, in one place.
 *
 * MeetingMind is free for everyone (owner policy, 2026-11). Every account gets every feature:
 * recording, transcript, summary, Q&A, cross-meeting chat, the meeting bot, phone-call recording,
 * calendar sync and exports. There are no paid tiers; the only server-side enforcement that ever
 * existed was the recording count below, and it is OFF unless FREE_TIER_LEGACY_LIMITS=true.
 *
 * The legacy recording limit (3 recordings for non-subscribers) is kept only as a dormant kill
 * switch for the create-recording route. `planFeatures()` does NOT read it: clients must not show
 * any paywall, so it always reports every feature as granted.
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

/**
 * Feature flags returned by GET /api/subscriptions/status. Everything is granted to every user.
 * Subscription state no longer changes what a user can do, so this takes no arguments.
 */
export function planFeatures(): PlanFeatures {
  return {
    unlimitedRecordings: true,
    aiSummaries: true,
    qaChat: true,
    meetingBot: true,
    phoneRecording: true,
    calendarSync: true,
    exportPdf: true,
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
