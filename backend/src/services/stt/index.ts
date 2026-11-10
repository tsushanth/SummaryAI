/**
 * STT provider selection for the batch / final transcript path.
 *
 *   STT_PROVIDER=deepgram (default; unknown values too)  Deepgram only. Production behaviour before this change. An unknown
 *                                                         value logs one warning per distinct value and uses Deepgram.
 *   STT_PROVIDER=soniox                                   Soniox async; on error/empty falls back to Deepgram when
 *                                                         STT_FALLBACK_TO_DEEPGRAM != 'false' and a Deepgram key exists.
 *   STT_PROVIDER=readaloud                                Self-hosted Whisper worker (candidate, off unless READALOUD_STT_URL and
 *                                                         READALOUD_STT_TOKEN are both set). Same fallback rules as soniox.
 *   STT_PROVIDER=shadow                                   Deepgram result is used. A candidate is ALSO called in the background
 *                                                         (concurrently, with a timeout) and one metrics-only row is written
 *                                                         to stt_shadow_runs. A shadow failure never reaches the user path, and
 *                                                         the candidate's transcript is never stored or shown.
 * Shadow mode sends the user's audio to a second processor even though the result is discarded, so it is opt-in per user:
 *   STT_SHADOW_USER_IDS=<id>,<id>   Only these recording owners are shadowed. Unset or empty = nobody (fails closed). There is no
 *                                   wildcard. A call without a user id is never shadowed.
 *   STT_SHADOW_CANDIDATE=soniox|readaloud   Which candidate shadow runs (default soniox). Any other non-empty value turns shadow
 *                                   off (and logs once) rather than guessing which vendor should receive the audio.
 *
 * The readaloud candidate (as the selected provider or as the shadow candidate) is only trusted for en, es, fr, de, pt, ru, ja, zh
 * (see languageGate.ts): a per-meeting language hint outside that set skips it before any audio is sent; with no hint, a detected
 * language outside the set discards its result. Both cases use Deepgram (or, where Deepgram is unavailable, keep going with the
 * candidate rather than fail the recording).
 *
 * Other env: SONIOX_API_KEY, READALOUD_STT_URL, READALOUD_STT_TOKEN, READALOUD_STT_TIMEOUT_MS, STT_SHADOW_TIMEOUT_MS (default
 * 900000), STT_SHADOW_SAMPLE_RATE (0..1, default 1), STT_SHADOW_MAX_RUNS (stop shadowing once the table has this many rows;
 * default unlimited).
 */
import { config } from '../../config/index.js';
import { classifyProviderError, reportAlert } from '../../lib/alerts.js';
import { deepgramProvider } from './deepgramProvider.js';
import { sonioxProvider } from './sonioxProvider.js';
import { isReadaloudConfigured, readaloudProvider } from './readaloudProvider.js';
import { detectedLanguageRejectReason, hasLanguageHint, languageHintSkipReason } from './languageGate.js';
import { supabaseShadowStore, type ShadowRunRow, type ShadowStatus, type ShadowStore } from './shadow.js';
import { normalizedWer } from './wer.js';
import type { NormalizedTranscript, SttOptions, SttProvider } from './types.js';

export type { NormalizedTranscript, SttOptions, SttProvider, TranscriptSegment } from './types.js';

export type SttMode = 'deepgram' | 'soniox' | 'readaloud' | 'shadow';

export interface SttRunOptions extends SttOptions {
  /** Only used to label the shadow row. */
  recordingId?: string;
  /** Owner of the recording. Only used to decide whether shadow mode may send this audio to a second processor; never forwarded. */
  userId?: string;
}
export interface SttResult {
  transcript: NormalizedTranscript;
  /** The provider that actually produced `transcript` (after any fallback). */
  provider: string;
  model: string;
}
export interface SttDeps {
  deepgram: SttProvider;
  soniox: SttProvider;
  readaloud: SttProvider;
  shadowStore: ShadowStore;
  env: NodeJS.ProcessEnv;
  random: () => number;
}

const DEFAULT_SHADOW_TIMEOUT_MS = 15 * 60_000;

const warnedUnknownModes = new Set<string>();
const warnedUnknownCandidates = new Set<string>();

export type ShadowCandidateName = 'soniox' | 'readaloud';

/** soniox (unset, empty or 'soniox'), readaloud, or null for any other value (shadow off). */
export function getShadowCandidateName(env: NodeJS.ProcessEnv = process.env): ShadowCandidateName | null {
  const v = String(env.STT_SHADOW_CANDIDATE ?? '').trim().toLowerCase();
  if (v === '' || v === 'soniox') return 'soniox';
  if (v === 'readaloud') return 'readaloud';
  if (!warnedUnknownCandidates.has(v)) {
    warnedUnknownCandidates.add(v);
    console.warn(`[STT shadow] unknown STT_SHADOW_CANDIDATE "${v.slice(0, 40)}"; shadow is off`);
  }
  return null;
}

/** Parsed STT_SHADOW_USER_IDS (comma separated, trimmed, lower-cased). Empty set = shadow runs for nobody. */
export function getShadowUserIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(String(env.STT_SHADOW_USER_IDS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
}

export function isShadowUser(userId: string | undefined | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const id = String(userId ?? '').trim().toLowerCase();
  return id.length > 0 && getShadowUserIds(env).has(id);
}

export function getSttMode(env: NodeJS.ProcessEnv = process.env): SttMode {
  const v = String(env.STT_PROVIDER ?? '').trim().toLowerCase();
  if (v === 'soniox' || v === 'readaloud' || v === 'shadow') return v;
  if (v && v !== 'deepgram' && !warnedUnknownModes.has(v)) {
    warnedUnknownModes.add(v);
    console.warn(`[STT] unknown STT_PROVIDER "${v.slice(0, 40)}"; using deepgram`);
  }
  return 'deepgram';
}

const hasSonioxKey = (env: NodeJS.ProcessEnv) => !!env.SONIOX_API_KEY && env.SONIOX_API_KEY.trim().length > 0;
const fallbackEnabled = (env: NodeJS.ProcessEnv) => String(env.STT_FALLBACK_TO_DEEPGRAM ?? '').trim().toLowerCase() !== 'false';

/** Can a real transcription be attempted? When false the caller uses the mock transcript (existing no-key behaviour). */
export function isSttConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const deepgram = !!config.DEEPGRAM_API_KEY;
  const mode = getSttMode(env);
  if (mode === 'soniox') return hasSonioxKey(env) || (fallbackEnabled(env) && deepgram);
  if (mode === 'readaloud') return isReadaloudConfigured(env) || (fallbackEnabled(env) && deepgram);
  return deepgram;
}

const isEmpty = (t: NormalizedTranscript) => t.wordCount === 0 && t.segments.length === 0 && !t.fullText.trim();
const toResult = (p: SttProvider, transcript: NormalizedTranscript): SttResult => ({ transcript, provider: p.name, model: p.model });

const pendingShadow = new Set<Promise<void>>();
/** Resolves when every background shadow run has finished (tests, graceful shutdown). Never rejects. */
export async function flushShadowRuns(): Promise<void> {
  await Promise.allSettled([...pendingShadow]);
}

export async function transcribeAudio(
  fileData: Blob,
  filePath: string,
  runOpts: SttRunOptions = {},
  overrides: Partial<SttDeps> = {}
): Promise<SttResult> {
  const d: SttDeps = { deepgram: deepgramProvider, soniox: sonioxProvider, readaloud: readaloudProvider, shadowStore: supabaseShadowStore, env: process.env, random: Math.random, ...overrides };
  const { recordingId, userId, durationHintSeconds, ...opts } = runOpts;
  const mode = getSttMode(d.env);

  if (mode === 'soniox') return transcribeWithCandidate(d, sonioxCandidate(d), fileData, filePath, opts);
  if (mode === 'readaloud') return transcribeWithCandidate(d, readaloudCandidate(d, durationHintSeconds), fileData, filePath, opts);
  if (mode === 'shadow') return transcribeWithShadow(d, fileData, filePath, opts, recordingId, userId, durationHintSeconds);
  return toResult(d.deepgram, await d.deepgram.transcribe(fileData, filePath, opts));
}

interface Candidate {
  provider: SttProvider;
  configured: boolean;
  /** provider_fallback alert code. */
  alert: string;
  missing: string;
  /** Options added to the candidate call only (never to Deepgram's). */
  extraOpts?: SttOptions;
  /** True when a per-meeting language hint rules this candidate out. */
  hintSkipReason?: (opts: SttOptions) => string | null;
  /** When set, a result in a language this returns a reason for is discarded (auto-detect only). */
  resultRejectReason?: (t: NormalizedTranscript) => string | null;
}

const sonioxCandidate = (d: SttDeps): Candidate => ({ provider: d.soniox, configured: hasSonioxKey(d.env), alert: 'SONIOX_TO_DEEPGRAM', missing: 'SONIOX_API_KEY is not set' });

function readaloudCandidate(d: SttDeps, durationHintSeconds?: number): Candidate {
  return {
    provider: d.readaloud,
    configured: isReadaloudConfigured(d.env),
    alert: 'READALOUD_TO_DEEPGRAM',
    missing: 'READALOUD_STT_URL / READALOUD_STT_TOKEN are not set',
    extraOpts: durationHintSeconds !== undefined ? { durationHintSeconds } : undefined,
    hintSkipReason: (opts) => languageHintSkipReason(opts.languageHints),
    // A pinned language is trusted as given; only auto-detected languages are checked.
    resultRejectReason: (t) => detectedLanguageRejectReason(t.detectedLanguage),
  };
}

const canUseDeepgram = (d: SttDeps) => fallbackEnabled(d.env) && !!config.DEEPGRAM_API_KEY;

/** A non-default provider with Deepgram as the fallback (error, empty result, or missing configuration). */
async function transcribeWithCandidate(d: SttDeps, c: Candidate, fileData: Blob, filePath: string, opts: SttOptions): Promise<SttResult> {
  let reason: 'no_key' | 'error' | 'empty';
  let failure: unknown;
  let emptyResult: NormalizedTranscript | undefined;

  if (!c.configured) {
    reason = 'no_key';
    failure = new Error(c.missing);
  } else {
    // Inputs the candidate must not or cannot take go straight to Deepgram: not a failure, so no alert. If Deepgram is not an
    // option the candidate is tried anyway (a transcript of lower trust beats a failed recording).
    const skip = c.hintSkipReason?.(opts) ?? (await c.provider.precheck?.(fileData, filePath, { ...opts, ...c.extraOpts }).catch(() => null)) ?? null;
    if (skip && canUseDeepgram(d)) {
      console.warn(`[STT] ${c.provider.name} skipped (${skip}); using deepgram`);
      return toResult(d.deepgram, await d.deepgram.transcribe(fileData, filePath, opts));
    }
    let discard: { reason: string; language: string } | null = null;
    try {
      const t = await c.provider.transcribe(fileData, filePath, { ...opts, ...c.extraOpts });
      if (!isEmpty(t)) {
        const reject = !hasLanguageHint(opts.languageHints) ? c.resultRejectReason?.(t) : null;
        if (!(reject && canUseDeepgram(d))) return toResult(c.provider, t);
        discard = { reason: reject, language: String(t.detectedLanguage).slice(0, 12) };
      } else {
        reason = 'empty';
        emptyResult = t;
      }
    } catch (e) {
      reason = 'error';
      failure = e;
    }
    if (discard) {
      // Deepgram is called outside the try above so that its own failure is not mistaken for a worker failure.
      console.warn(`[STT] ${c.provider.name} result discarded (${discard.reason}, detected ${discard.language}); using deepgram`);
      return toResult(d.deepgram, await d.deepgram.transcribe(fileData, filePath, opts));
    }
  }

  if (!(fallbackEnabled(d.env) && config.DEEPGRAM_API_KEY)) {
    if (emptyResult) return toResult(c.provider, emptyResult); // genuinely silent audio: a valid, empty transcript
    throw failure;
  }
  reportAlert('provider_fallback', c.alert, { reason, class: failure ? classifyProviderError(failure) : undefined });
  console.warn(`[STT] ${c.provider.name} ${reason}; falling back to deepgram`);
  return toResult(d.deepgram, await d.deepgram.transcribe(fileData, filePath, opts));
}

interface ShadowOutcome {
  status: ShadowStatus;
  errorClass: string | null;
  transcript: NormalizedTranscript | null;
  latencyMs: number | null;
  /** Language the candidate reported when its transcript was discarded for being outside the trusted set. */
  discardedLanguage?: string;
}

interface ShadowTarget {
  provider: SttProvider;
  configured: boolean;
  /** Options for the candidate call only. */
  extraOpts: SttOptions;
  hintSkipReason?: (opts: SttOptions) => string | null;
  resultRejectReason?: (t: NormalizedTranscript) => string | null;
}

function shadowTarget(d: SttDeps, name: ShadowCandidateName, durationHintSeconds?: number): ShadowTarget {
  if (name === 'readaloud') {
    return {
      provider: d.readaloud,
      configured: isReadaloudConfigured(d.env),
      // The shadow transcript is never shown, so part-local speakers are acceptable for long inputs that get split.
      extraOpts: { allowChunkLocalSpeakers: true, ...(durationHintSeconds !== undefined ? { durationHintSeconds } : {}) },
      hintSkipReason: (opts) => languageHintSkipReason(opts.languageHints),
      resultRejectReason: (t) => detectedLanguageRejectReason(t.detectedLanguage),
    };
  }
  return { provider: d.soniox, configured: hasSonioxKey(d.env), extraOpts: {} };
}

/**
 * Starts the candidate side. Returns null when shadowing is off for this recording. The promise never rejects.
 * Order of checks (nothing is sent to the candidate unless all pass): candidate name valid, recording owner on the allow-list,
 * candidate configured, sample rate, language hint trusted by the candidate, input accepted by the candidate, row cap and table
 * readable.
 */
function startShadow(d: SttDeps, fileData: Blob, filePath: string, opts: SttOptions, userId?: string, durationHintSeconds?: number): Promise<ShadowOutcome | null> | null {
  const name = getShadowCandidateName(d.env);
  if (!name) return null;
  if (!isShadowUser(userId, d.env)) return null; // fail closed: unset / empty list, or an owner not on it, or no owner id
  const target = shadowTarget(d, name, durationHintSeconds);
  if (!target.configured) return null;
  const rateRaw = d.env.STT_SHADOW_SAMPLE_RATE;
  const rate = rateRaw === undefined || rateRaw === '' || !Number.isFinite(Number(rateRaw)) ? 1 : Number(rateRaw);
  if (rate <= 0 || (rate < 1 && d.random() >= rate)) return null;
  const hintSkip = target.hintSkipReason?.(opts);
  if (hintSkip) {
    console.log(`[STT shadow] skipped: ${name} ${hintSkip}`);
    return null;
  }
  const cap = Number(d.env.STT_SHADOW_MAX_RUNS) || 0;
  const timeoutMs = Number(d.env.STT_SHADOW_TIMEOUT_MS) || DEFAULT_SHADOW_TIMEOUT_MS;

  return (async (): Promise<ShadowOutcome | null> => {
    const inputSkip = await target.provider.precheck?.(fileData, filePath, { ...opts, ...target.extraOpts }).catch(() => null);
    if (inputSkip) {
      console.log(`[STT shadow] skipped: ${name} ${inputSkip}`);
      return null;
    }
    try {
      // Readability check first: if migration 025 is not applied, no audio is sent anywhere.
      const existing = await d.shadowStore.count();
      if (cap > 0 && existing >= cap) return null;
    } catch (e) {
      console.warn('[STT shadow] stt_shadow_runs not readable; shadow skipped:', e instanceof Error ? e.message : e);
      return null;
    }
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`shadow call timed out after ${timeoutMs}ms`), { name: 'TimeoutError' })), timeoutMs);
      });
      const transcript = await Promise.race([target.provider.transcribe(fileData, filePath, { ...opts, ...target.extraOpts, timeoutMs }), timeout]);
      const latencyMs = Date.now() - started;
      if (isEmpty(transcript)) return { status: 'shadow_empty', errorClass: null, transcript, latencyMs };
      const reject = !hasLanguageHint(opts.languageHints) ? target.resultRejectReason?.(transcript) : null;
      if (reject) {
        // Discarded: counted as an error with a distinct class (the status column is a closed list), and no content metrics kept.
        console.log(`[STT shadow] ${name} result discarded: ${reject}`);
        return { status: 'shadow_error', errorClass: reject.toUpperCase(), transcript: null, latencyMs, discardedLanguage: transcript.detectedLanguage };
      }
      return { status: 'ok', errorClass: null, transcript, latencyMs };
    } catch (e) {
      const errorClass = classifyProviderError(e);
      return { status: errorClass === 'TIMEOUT' ? 'shadow_timeout' : 'shadow_error', errorClass, transcript: null, latencyMs: Date.now() - started };
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
}

async function transcribeWithShadow(d: SttDeps, fileData: Blob, filePath: string, opts: SttOptions, recordingId?: string, userId?: string, durationHintSeconds?: number): Promise<SttResult> {
  const shadow = startShadow(d, fileData, filePath, opts, userId, durationHintSeconds); // concurrent with the primary call, not awaited
  const t0 = Date.now();
  const primary = await d.deepgram.transcribe(fileData, filePath, opts); // a Deepgram failure behaves exactly as before
  const primaryLatencyMs = Date.now() - t0;

  if (shadow) {
    const shadowProvider = getShadowCandidateName(d.env) === 'readaloud' ? d.readaloud : d.soniox;
    const run = (async () => {
      const outcome = await shadow;
      if (!outcome) return;
      const sh = outcome.transcript;
      const row: ShadowRunRow = {
        recording_id: recordingId ?? null,
        primary_provider: d.deepgram.name,
        primary_model: d.deepgram.model,
        shadow_provider: shadowProvider.name,
        shadow_model: shadowProvider.model,
        status: outcome.status,
        error_class: outcome.errorClass,
        primary_word_count: primary.wordCount,
        shadow_word_count: sh ? sh.wordCount : null,
        primary_duration_seconds: primary.durationSeconds ?? null,
        shadow_duration_seconds: sh ? sh.durationSeconds ?? null : null,
        primary_language: primary.detectedLanguage,
        shadow_language: sh ? sh.detectedLanguage : outcome.discardedLanguage ?? null,
        primary_speaker_count: primary.speakerCount,
        shadow_speaker_count: sh ? sh.speakerCount : null,
        wer_vs_primary: null,
        primary_latency_ms: primaryLatencyMs,
        shadow_latency_ms: outcome.latencyMs,
      };
      if (sh && outcome.status === 'ok') {
        const wer = normalizedWer(primary.fullText, sh.fullText);
        row.wer_vs_primary = wer === null ? null : Math.round(wer * 10000) / 10000;
      }
      console.log(
        `[STT shadow] status=${row.status} rec=${row.recording_id ?? '-'} words=${row.primary_word_count}/${row.shadow_word_count ?? '-'} ` +
          `dur=${row.primary_duration_seconds ?? '-'}/${row.shadow_duration_seconds ?? '-'} lang=${row.primary_language}/${row.shadow_language ?? '-'} ` +
          `speakers=${row.primary_speaker_count}/${row.shadow_speaker_count ?? '-'} wer=${row.wer_vs_primary ?? '-'} ` +
          `latency_ms=${row.primary_latency_ms}/${row.shadow_latency_ms ?? '-'} err=${row.error_class ?? '-'}`
      );
      await d.shadowStore.insert(row);
    })().catch((e) => {
      console.warn('[STT shadow] could not record comparison:', e instanceof Error ? e.message : e);
    });
    pendingShadow.add(run);
    void run.finally(() => pendingShadow.delete(run));
  }
  return toResult(d.deepgram, primary);
}
