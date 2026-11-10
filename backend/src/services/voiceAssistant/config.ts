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
}

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
