/**
 * In-meeting voice assistant: flags and caps. See docs/VOICE_ASSISTANT.md.
 *
 * Everything is read from the environment at call time (not cached at import), so the kill switch is honoured by the next
 * event after the process restarts with the new value, and tests can flip it without reloading modules. An unknown or
 * malformed value always resolves to the SAFE side (off / the default cap), it never crashes the boot.
 *
 * Switches, in order of precedence:
 *   VOICE_ASSISTANT_KILL=1            global kill switch: nothing joins with the assistant and a running one goes silent
 *   profiles.preferences.voice_assistant === false   the user opted out: off for that user in every mode
 *   VOICE_ASSISTANT_MODE              off (default) | opt_in | all
 *       opt_in = profiles.preferences.voice_assistant === true, or the user id is in VOICE_ASSISTANT_USER_IDS
 *       all    = every user who has not opted out
 *   VOICE_ASSISTANT_WAKE_SOURCE       recall (default) | live_stt
 *       live_stt = for a bot that has a live-stt stream (LIVE_STT_SHADOW user or LIVE_STT_PROVIDER=soniox), the wake phrase and the
 *       question come from that stream's final segments; Recall's events then only supply barge-in signals. Other bots: unchanged.
 *   MEETING_ASSISTANT_MULTILINGUAL    off (default) | on. Language-aware assistant (see docs/VOICE_ASSISTANT.md, "Other languages"). OFF changes nothing.
 *       MEETING_ASSISTANT_LANGUAGES (default "ru"), MEETING_ASSISTANT_TTS_VOICES ("ru=aria"), MEETING_ASSISTANT_WAKE_PHRASES (JSON),
 *       MEETING_ASSISTANT_TTS_USD_PER_1K_CHARS (cost estimate) refine it; the speech provider key is READALOUD_API_KEY.
 */

export type VoiceAssistantMode = 'off' | 'opt_in' | 'all';
/** Who may make the assistant read from PAST meetings. The live meeting is always answerable for any participant. */
export type HistoryPolicy = 'owner' | 'owner_email' | 'anyone' | 'off';
export type TtsProviderName = 'deepgram' | 'openai';
/** Which transcript stream may start a question: Recall's real-time transcript (default) or the live-stt (Soniox) segments. */
export type WakeSource = 'recall' | 'live_stt';

export interface VoiceAssistantConfig {
  mode: VoiceAssistantMode;
  killed: boolean;
  userIds: Set<string>;
  historyPolicy: HistoryPolicy;
  /** Only has an effect for a bot that has a live-stt stream (shadow or soniox); every other bot always uses Recall. */
  wakeSource: WakeSource;
  maxQuestionsPerMeeting: number;
  maxQuestionsPerUserPerDay: number;
  /** Hard cap on the SPOKEN answer, in characters (about 35 words at 450). */
  maxAnswerChars: number;
  /** Global spend breaker, USD per UTC day (LLM + TTS estimate). Over it, nobody gets answers until the next day. */
  dailySpendCapUsd: number;
  /** Alert when failures / attempts over the last hour exceeds this, with at least failureAlertMinAttempts attempts. */
  failureAlertRate: number;
  failureAlertMinAttempts: number;
  /** An answer ready later than this after the question is dropped as stale. */
  staleAnswerMs: number;
  /** The whole think step (tool loop) is abandoned after this long. */
  answerTimeoutMs: number;
  model: string | null; // null = the backend's summary model
  maxTokens: number;
  ttsProvider: TtsProviderName;
  ttsVoice: string;
  ttsUsdPer1kChars: number;
  intro: boolean;
  cue: boolean;
  /** MEETING_ASSISTANT_MULTILINGUAL, default OFF. Every non-English behaviour sits behind it; OFF = the English-only assistant exactly as before. */
  multilingual: boolean;
  /** Languages other than English the assistant may answer in (needs a language pack and a voice). Default ['ru']. */
  languages: string[];
  /** language code -> voice id for the non-English TTS provider. Entries override the built-in defaults. */
  languageVoices: Record<string, string>;
  /** Extra wake phrases per language code (literal phrases, matched at the start of an utterance). */
  extraWakePhrases: Record<string, string[]>;
  /** Estimate only: USD per 1,000 characters for the non-English TTS provider. */
  readaloudUsdPer1kChars: number;
  /** language code -> whether the speech request asks the provider to normalise numbers. See NUMBER_NORMALIZE_DEFAULTS. */
  numberNormalize: Record<string, 'numbers' | 'none'>;
}

/**
 * Per-language policy for the provider's own number reading (measured on production, 2026-11-14). Only these languages may send
 * normalize:'numbers'; it is never sent for en, ja or ru (ru measured worse with it), pt is on hold. Every language NOT listed as
 * 'numbers' gets its answer text with numbers spelled as words (prompt rule plus a digit post-check before speech).
 * Known engine limits: OTP-like codes are read as one big number in es/fr/it/pt, percent decimals lose the decimal without
 * normalisation in de/fr/it/pt/ru, ordinals are only right in English.
 */
export const NUMBER_NORMALIZE_DEFAULTS: Readonly<Record<string, 'numbers' | 'none'>> = {
  de: 'numbers', fr: 'numbers', it: 'numbers', es: 'numbers',
  en: 'none', ja: 'none', ru: 'none', pt: 'none',
};

const TRUE = new Set(['1', 'true', 'yes', 'on']);
export const truthy = (v: string | undefined): boolean => TRUE.has((v ?? '').trim().toLowerCase());

function posNumber(v: string | undefined, dflt: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number((v ?? '').trim());
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n > 0 && n <= max ? n : dflt;
}

function parseMode(v: string | undefined): VoiceAssistantMode {
  const m = (v ?? 'off').trim().toLowerCase();
  return m === 'all' || m === 'opt_in' ? m : 'off';
}

function parsePolicy(v: string | undefined): HistoryPolicy {
  const m = (v ?? 'owner').trim().toLowerCase();
  return m === 'owner_email' || m === 'anyone' || m === 'off' ? m : 'owner';
}

function parseWakeSource(v: string | undefined): WakeSource {
  return (v ?? 'recall').trim().toLowerCase() === 'live_stt' ? 'live_stt' : 'recall';
}

/** 'ru,de' -> ['ru','de'] (lowercase primary subtags, de-duplicated; 'en' is always supported and is not listed). */
function parseLanguages(v: string | undefined): string[] {
  const raw = v === undefined ? 'ru' : v;
  const out = raw.split(',').map((s) => s.trim().toLowerCase().split(/[-_]/)[0] ?? '').filter((s) => /^[a-z]{2,3}$/.test(s) && s !== 'en');
  return [...new Set(out)];
}

/** 'ru=aria,de=kai' -> { ru: 'aria', de: 'kai' }. Malformed pairs are skipped. */
function parseVoiceMap(v: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (v ?? '').split(',')) {
    const [k, val] = pair.split('=').map((s) => s.trim());
    if (k && val && /^[a-z]{2,3}$/i.test(k) && /^[A-Za-z0-9_.-]{1,64}$/.test(val)) out[k.toLowerCase()] = val;
  }
  return out;
}

/** 'de=numbers,ru=none' on top of NUMBER_NORMALIZE_DEFAULTS. A language never listed resolves to 'none' (digits are spelled out). */
function parseNormalize(v: string | undefined): Record<string, 'numbers' | 'none'> {
  const out: Record<string, 'numbers' | 'none'> = { ...NUMBER_NORMALIZE_DEFAULTS };
  for (const pair of (v ?? '').split(',')) {
    const [k, val] = pair.split('=').map((x) => x.trim().toLowerCase());
    if (k && /^[a-z]{2,3}$/.test(k) && (val === 'numbers' || val === 'none')) out[k] = val;
  }
  return out;
}

/** JSON {"ru": ["phrase", ...]}. Anything malformed is ignored (the built-in phrases still work). */
function parseWakeMap(v: string | undefined): Record<string, string[]> {
  if (!v || !v.trim()) return {};
  try {
    const j = JSON.parse(v) as unknown;
    const out: Record<string, string[]> = {};
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      for (const [k, arr] of Object.entries(j as Record<string, unknown>)) {
        if (!/^[a-z]{2,3}$/i.test(k) || !Array.isArray(arr)) continue;
        const phrases = arr.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x.length >= 4 && x.length <= 60);
        if (phrases.length) out[k.toLowerCase()] = phrases.slice(0, 20);
      }
    }
    return out;
  } catch { return {}; }
}

export function loadVoiceAssistantConfig(env: NodeJS.ProcessEnv = process.env): VoiceAssistantConfig {
  const provider = (env.VOICE_ASSISTANT_TTS_PROVIDER ?? 'deepgram').trim().toLowerCase();
  return {
    mode: parseMode(env.VOICE_ASSISTANT_MODE),
    killed: truthy(env.VOICE_ASSISTANT_KILL),
    userIds: new Set((env.VOICE_ASSISTANT_USER_IDS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
    historyPolicy: parsePolicy(env.VOICE_ASSISTANT_HISTORY_POLICY),
    wakeSource: parseWakeSource(env.VOICE_ASSISTANT_WAKE_SOURCE),
    maxQuestionsPerMeeting: Math.floor(posNumber(env.VOICE_ASSISTANT_MAX_QUESTIONS_PER_MEETING, 15, 200)),
    maxQuestionsPerUserPerDay: Math.floor(posNumber(env.VOICE_ASSISTANT_MAX_QUESTIONS_PER_USER_DAY, 40, 1000)),
    maxAnswerChars: Math.floor(posNumber(env.VOICE_ASSISTANT_MAX_ANSWER_CHARS, 450, 1000)),
    dailySpendCapUsd: posNumber(env.VOICE_ASSISTANT_DAILY_SPEND_CAP_USD, 10),
    failureAlertRate: posNumber(env.VOICE_ASSISTANT_FAILURE_ALERT_RATE, 0.3, 1),
    failureAlertMinAttempts: Math.floor(posNumber(env.VOICE_ASSISTANT_FAILURE_ALERT_MIN_ATTEMPTS, 8, 1000)),
    staleAnswerMs: Math.floor(posNumber(env.VOICE_ASSISTANT_STALE_MS, 30_000, 300_000)),
    answerTimeoutMs: Math.floor(posNumber(env.VOICE_ASSISTANT_ANSWER_TIMEOUT_MS, 20_000, 120_000)),
    model: (env.VOICE_ASSISTANT_MODEL ?? '').trim() || null,
    maxTokens: Math.floor(posNumber(env.VOICE_ASSISTANT_MAX_TOKENS, 350, 2000)),
    ttsProvider: provider === 'openai' ? 'openai' : 'deepgram',
    ttsVoice: (env.VOICE_ASSISTANT_TTS_VOICE ?? '').trim(),
    // Deepgram Aura-1 list price, USD per 1,000 characters (Aura-2 is 0.03: set this if you pick an Aura-2 voice). Estimate only.
    ttsUsdPer1kChars: posNumber(env.VOICE_ASSISTANT_TTS_USD_PER_1K_CHARS, 0.015),
    intro: env.VOICE_ASSISTANT_INTRO === undefined ? true : truthy(env.VOICE_ASSISTANT_INTRO),
    cue: env.VOICE_ASSISTANT_CUE === undefined ? true : truthy(env.VOICE_ASSISTANT_CUE),
    multilingual: truthy(env.MEETING_ASSISTANT_MULTILINGUAL),
    languages: parseLanguages(env.MEETING_ASSISTANT_LANGUAGES),
    languageVoices: parseVoiceMap(env.MEETING_ASSISTANT_TTS_VOICES),
    extraWakePhrases: parseWakeMap(env.MEETING_ASSISTANT_WAKE_PHRASES),
    // Unverified list-price estimate for the higher-priced tier; set the real figure. Only used for the cost counters.
    readaloudUsdPer1kChars: posNumber(env.MEETING_ASSISTANT_TTS_USD_PER_1K_CHARS, 0.01),
    numberNormalize: parseNormalize(env.MEETING_ASSISTANT_TTS_NORMALIZE),
  };
}

export type EnableReason = 'enabled' | 'killed' | 'mode_off' | 'user_opted_out' | 'not_opted_in';

/**
 * Decide for one user. `preference` is profiles.preferences.voice_assistant: true / false / undefined (never set).
 * Pure: no I/O, so the whole decision table is unit-tested.
 */
export function decideEnabled(
  cfg: VoiceAssistantConfig,
  userId: string | undefined,
  preference: boolean | undefined,
): { enabled: boolean; reason: EnableReason } {
  if (cfg.killed) return { enabled: false, reason: 'killed' };
  if (cfg.mode === 'off') return { enabled: false, reason: 'mode_off' };
  if (preference === false) return { enabled: false, reason: 'user_opted_out' };
  if (cfg.mode === 'all') return { enabled: !!userId, reason: userId ? 'enabled' : 'not_opted_in' };
  const allowListed = !!userId && cfg.userIds.has(userId.trim().toLowerCase());
  return preference === true || allowListed ? { enabled: true, reason: 'enabled' } : { enabled: false, reason: 'not_opted_in' };
}
