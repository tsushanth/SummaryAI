/**
 * createBot side of the voice assistant: decides, per bot, whether the assistant is wired in, and builds the pieces
 * (a second real-time webhook endpoint for the transcript, and the one short intro played when the bot joins).
 *
 * Everything here fails CLOSED and SOFT: if anything is missing or slow, the bot is created exactly as it was before
 * (recording and notes are never put at risk by this feature).
 *
 * Webhook authenticity. The existing /webhooks/recall/transcript route only logs signature problems (phase 1), which is not good
 * enough for a route that can make the bot read private data aloud. The assistant therefore has its own route, and the URL carries a
 * token derived from INTERNAL_SECRET (HMAC). The route accepts a delivery only with a valid token or a valid Recall signature.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { reportAlert } from '../../lib/alerts.js';
import { decideEnabled } from './config.js';
import { getLanguagePack, isNonEnglishConfigured, isSupportedLanguage } from './languages.js';
import { getConfig, loadVoicePreference, phraseAudio } from './runtime.js';
import { INTRO_TEXT } from './tts.js';

export const ASSISTANT_WEBHOOK_PATH = '/v1/webhooks/recall-assistant';

export function assistantWebhookToken(secret: string): string {
  return createHmac('sha256', secret).update('meetingmind-voice-assistant-webhook-v1').digest('hex').slice(0, 40);
}

export function isValidAssistantToken(provided: string | undefined, secret: string | undefined): boolean {
  if (!provided || !secret) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(assistantWebhookToken(secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AssistantBotPlan {
  /**
   * Entry to append to recording_config.realtime_endpoints. Null only for a Soniox-primary bot in multilingual mode: the transcript
   * is the live-stt stream, there is no Recall transcript to listen to, so no endpoint is added (the intro still plays).
   */
  endpoint: { type: 'webhook'; url: string; events: string[] } | null;
  /** Recall `automatic_audio_output` field, or undefined when the intro is off / could not be synthesized in time. */
  automaticAudioOutput?: { in_call_recording: { data: { kind: 'mp3'; b64_data: string } } };
}

export interface PlanInput {
  userId: string | undefined;
  serviceUrl: string | undefined;
  internalSecret: string | undefined;
  /** Real-time transcript is on and Recall's own transcript is the live source (not the Soniox-only path). */
  realtimeRecallTranscript: boolean;
  /** Multilingual mode only. Which live-stt stream this bot has: 'soniox' (primary), 'shadow' (next to Recall's transcript) or 'recall' / absent (none). */
  liveStreamProvider?: 'recall' | 'shadow' | 'soniox';
  /** Multilingual mode only. The meeting language from settings ('auto' / null = none). */
  meetingLanguage?: string | null;
  /** Test seams. */
  preference?: (userId: string) => Promise<boolean | undefined>;
  intro?: (text: string, language?: string) => Promise<string | null>;
}

const INTRO_WAIT_MS = 2500;

async function introB64(text: string, language?: string): Promise<string | null> {
  try {
    const audio = await Promise.race([
      language ? phraseAudio(text, language) : phraseAudio(text),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), INTRO_WAIT_MS)),
    ]);
    return audio ? audio.b64 : null;
  } catch {
    return null;
  }
}

/** Returns the plan, or null when the assistant must not be wired into this bot (the reason is logged, never thrown). */
export async function planVoiceAssistant(input: PlanInput): Promise<AssistantBotPlan | null> {
  try {
    const cfg = getConfig();
    if (cfg.killed || cfg.mode === 'off' || !input.userId) return null;
    const preference = await (input.preference ?? loadVoicePreference)(input.userId);
    const decision = decideEnabled(cfg, input.userId, preference);
    if (!decision.enabled) return null;

    // Multilingual mode (MEETING_ASSISTANT_MULTILINGUAL). Everything in this block is skipped while the flag is off.
    let introText = INTRO_TEXT;
    let introLang: string | undefined;
    if (cfg.multilingual) {
      const stream = input.liveStreamProvider ?? 'recall';
      const nonEnglish = isNonEnglishConfigured(input.meetingLanguage);
      const lang = nonEnglish ? input.meetingLanguage!.trim().toLowerCase().split(/[-_]/)[0]! : null;
      if (nonEnglish && stream === 'recall') {
        // Recall's live transcript is English only (and arrives minutes late otherwise): a non-English meeting needs a live-stt stream.
        console.warn('[VoiceAssistant] non-English meeting without a live-stt stream; bot created without the assistant');
        return null;
      }
      if (nonEnglish && stream === 'shadow' && cfg.wakeSource !== 'live_stt') {
        console.warn('[VoiceAssistant] non-English meeting, shadow stream but VOICE_ASSISTANT_WAKE_SOURCE is not live_stt; bot created without the assistant');
        return null;
      }
      if (lang && isSupportedLanguage(cfg, lang)) {
        const pack = getLanguagePack(lang);
        if (pack) { introText = pack.strings.intro; introLang = lang; }
      }
      if (stream === 'soniox') {
        // Soniox primary: the transcript is the live-stt stream. No Recall endpoint (nothing would arrive on it), the intro still plays.
        const b64 = cfg.intro ? await (input.intro ?? introB64)(introText, introLang) : null;
        return { endpoint: null, automaticAudioOutput: b64 ? { in_call_recording: { data: { kind: 'mp3', b64_data: b64 } } } : undefined };
      }
    }

    if (!input.realtimeRecallTranscript || !input.serviceUrl) {
      console.warn('[VoiceAssistant] enabled for this user but the Recall real-time transcript is not available; bot created without the assistant');
      return null;
    }
    if (!input.internalSecret) {
      console.error('[VoiceAssistant] INTERNAL_SECRET is not set, so the assistant webhook cannot be authenticated; bot created without the assistant');
      reportAlert('voice_assistant', 'NO_WEBHOOK_SECRET', {}, 6 * 3_600_000);
      return null;
    }
    const url = `${input.serviceUrl.replace(/\/+$/, '')}${ASSISTANT_WEBHOOK_PATH}?vt=${assistantWebhookToken(input.internalSecret)}`;
    const b64 = cfg.intro ? await (input.intro ?? introB64)(introText, introLang) : null;
    return {
      endpoint: { type: 'webhook', url, events: ['transcript.data', 'transcript.partial_data'] },
      automaticAudioOutput: b64 ? { in_call_recording: { data: { kind: 'mp3', b64_data: b64 } } } : undefined,
    };
  } catch (err) {
    console.error('[VoiceAssistant] plan failed, bot created without the assistant:', (err as Error)?.message);
    return null;
  }
}
