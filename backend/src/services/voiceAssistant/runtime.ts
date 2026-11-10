/**
 * Production singletons and Supabase loaders for the voice assistant. Kept free of RecallService so recallService.ts can use
 * it (createBot) without an import cycle.
 */
import { supabaseAdmin } from '../../lib/supabase.js';
import { loadVoiceAssistantConfig } from './config.js';
import { supabaseEventStore, pushUsageToWorker, VoiceMetrics } from './metrics.js';
import { cachedPhrases, createSynthesizer } from './tts.js';
import type { OwnerIdentity } from './wake.js';

/** `liveStt`: the bot run has a live-stt stream (bot_runs.live_stt_provider is soniox or shadow). */
export interface BotContext { botRunId: string; meetingId: string; userId: string; liveStt?: boolean }


export const getConfig = () => loadVoiceAssistantConfig();

export const voiceMetrics = new VoiceMetrics({ getConfig, store: supabaseEventStore(), pushUsage: pushUsageToWorker });
export const synth = createSynthesizer(getConfig);
export const phraseAudio = cachedPhrases(synth, getConfig);

export async function lookupBotRun(recallBotId: string): Promise<BotContext | null> {
  const { data, error } = await supabaseAdmin.from('bot_runs').select('id, meeting_id, user_id, live_stt_provider').eq('recall_bot_id', recallBotId).maybeSingle();
  if (error || !data) return null;
  const provider = (data as any).live_stt_provider;
  return { botRunId: (data as any).id, meetingId: (data as any).meeting_id, userId: (data as any).user_id, liveStt: provider === 'soniox' || provider === 'shadow' };
}

export async function loadVoicePreference(userId: string): Promise<boolean | undefined> {
  const { data } = await supabaseAdmin.from('profiles').select('preferences').eq('id', userId).maybeSingle();
  const v = (data as { preferences?: Record<string, unknown> } | null)?.preferences?.voice_assistant;
  return typeof v === 'boolean' ? v : undefined;
}

export async function loadOwnerIdentity(userId: string): Promise<OwnerIdentity> {
  const names: string[] = [];
  let email: string | null = null;
  try {
    const { data } = await supabaseAdmin.from('profiles').select('email, display_name').eq('id', userId).maybeSingle();
    if ((data as any)?.display_name) names.push(String((data as any).display_name));
    email = (data as any)?.email ?? null;
  } catch { /* fall through to auth metadata */ }
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
    for (const k of ['full_name', 'name']) if (typeof meta[k] === 'string' && meta[k]) names.push(String(meta[k]));
    email = email ?? data?.user?.email ?? null;
  } catch { /* names stay as they are */ }
  return { email, names: [...new Set(names)] };
}

export async function loadLiveSeed(meetingId: string, userId: string): Promise<Array<{ at: number; speaker: string; text: string }>> {
  const { data } = await supabaseAdmin.from('live_transcripts')
    .select('speaker_name, segment_text, created_at')
    .eq('meeting_id', meetingId).eq('user_id', userId).eq('is_partial', false).eq('shadow', false)
    .order('created_at', { ascending: false }).limit(60);
  return ((data ?? []) as any[]).reverse().map((r) => ({ at: Date.parse(r.created_at) || Date.now(), speaker: r.speaker_name || 'Someone', text: String(r.segment_text ?? '') }));
}

