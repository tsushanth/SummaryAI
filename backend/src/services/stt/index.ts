/**
 * STT provider selection for the batch / final transcript path.
 *
 *   STT_PROVIDER=deepgram (default; unknown values too)  Deepgram only. Production behaviour before this change.
 *   STT_PROVIDER=soniox                                   Soniox async; on error/empty falls back to Deepgram when
 *                                                         STT_FALLBACK_TO_DEEPGRAM != 'false' and a Deepgram key exists.
 *   STT_PROVIDER=shadow                                   Deepgram result is used. Soniox is ALSO called in the background
 *                                                         (concurrently, with a timeout) and one metrics-only row is written
 *                                                         to stt_shadow_runs. A shadow failure never reaches the user path.
 * Shadow mode sends the user's audio to Soniox: it is a processor change even though the result is discarded.
 *
 * Other env: SONIOX_API_KEY, STT_SHADOW_TIMEOUT_MS (default 900000), STT_SHADOW_SAMPLE_RATE (0..1, default 1),
 * STT_SHADOW_MAX_RUNS (stop shadowing once the table has this many rows; default unlimited).
 */
import { config } from '../../config/index.js';
import { classifyProviderError, reportAlert } from '../../lib/alerts.js';
import { deepgramProvider } from './deepgramProvider.js';
import { sonioxProvider } from './sonioxProvider.js';
import { supabaseShadowStore, type ShadowRunRow, type ShadowStatus, type ShadowStore } from './shadow.js';
import { normalizedWer } from './wer.js';
import type { NormalizedTranscript, SttOptions, SttProvider } from './types.js';

export type { NormalizedTranscript, SttOptions, SttProvider, TranscriptSegment } from './types.js';

export type SttMode = 'deepgram' | 'soniox' | 'shadow';

export interface SttRunOptions extends SttOptions {
  /** Only used to label the shadow row. */
  recordingId?: string;
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
  shadowStore: ShadowStore;
  env: NodeJS.ProcessEnv;
  random: () => number;
}

const DEFAULT_SHADOW_TIMEOUT_MS = 15 * 60_000;

export function getSttMode(env: NodeJS.ProcessEnv = process.env): SttMode {
  const v = String(env.STT_PROVIDER ?? '').trim().toLowerCase();
  return v === 'soniox' || v === 'shadow' ? v : 'deepgram';
}

const hasSonioxKey = (env: NodeJS.ProcessEnv) => !!env.SONIOX_API_KEY && env.SONIOX_API_KEY.trim().length > 0;
const fallbackEnabled = (env: NodeJS.ProcessEnv) => String(env.STT_FALLBACK_TO_DEEPGRAM ?? '').trim().toLowerCase() !== 'false';

/** Can a real transcription be attempted? When false the caller uses the mock transcript (existing no-key behaviour). */
export function isSttConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const deepgram = !!config.DEEPGRAM_API_KEY;
  if (getSttMode(env) === 'soniox') return hasSonioxKey(env) || (fallbackEnabled(env) && deepgram);
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
  const d: SttDeps = { deepgram: deepgramProvider, soniox: sonioxProvider, shadowStore: supabaseShadowStore, env: process.env, random: Math.random, ...overrides };
  const { recordingId, ...opts } = runOpts;
  const mode = getSttMode(d.env);

  if (mode === 'soniox') return transcribeWithSoniox(d, fileData, filePath, opts);
  if (mode === 'shadow') return transcribeWithShadow(d, fileData, filePath, opts, recordingId);
  return toResult(d.deepgram, await d.deepgram.transcribe(fileData, filePath, opts));
}

async function transcribeWithSoniox(d: SttDeps, fileData: Blob, filePath: string, opts: SttOptions): Promise<SttResult> {
  let reason: 'no_key' | 'error' | 'empty';
  let failure: unknown;
  let emptyResult: NormalizedTranscript | undefined;

  if (!hasSonioxKey(d.env)) {
    reason = 'no_key';
    failure = new Error('SONIOX_API_KEY is not set');
  } else {
    try {
      const t = await d.soniox.transcribe(fileData, filePath, opts);
      if (!isEmpty(t)) return toResult(d.soniox, t);
      reason = 'empty';
      emptyResult = t;
    } catch (e) {
      reason = 'error';
      failure = e;
    }
  }

  if (!(fallbackEnabled(d.env) && config.DEEPGRAM_API_KEY)) {
    if (emptyResult) return toResult(d.soniox, emptyResult); // genuinely silent audio: a valid, empty transcript
    throw failure;
  }
  reportAlert('provider_fallback', 'SONIOX_TO_DEEPGRAM', { reason, class: failure ? classifyProviderError(failure) : undefined });
  console.warn(`[STT] soniox ${reason}; falling back to deepgram`);
  return toResult(d.deepgram, await d.deepgram.transcribe(fileData, filePath, opts));
}

interface ShadowOutcome {
  status: ShadowStatus;
  errorClass: string | null;
  transcript: NormalizedTranscript | null;
  latencyMs: number | null;
}

/** Starts the Soniox side. Returns null when shadowing is off for this recording. The promise never rejects. */
function startShadow(d: SttDeps, fileData: Blob, filePath: string, opts: SttOptions): Promise<ShadowOutcome | null> | null {
  if (!hasSonioxKey(d.env)) return null;
  const rateRaw = d.env.STT_SHADOW_SAMPLE_RATE;
  const rate = rateRaw === undefined || rateRaw === '' || !Number.isFinite(Number(rateRaw)) ? 1 : Number(rateRaw);
  if (rate <= 0 || (rate < 1 && d.random() >= rate)) return null;
  const cap = Number(d.env.STT_SHADOW_MAX_RUNS) || 0;
  const timeoutMs = Number(d.env.STT_SHADOW_TIMEOUT_MS) || DEFAULT_SHADOW_TIMEOUT_MS;

  return (async (): Promise<ShadowOutcome | null> => {
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
      const transcript = await Promise.race([d.soniox.transcribe(fileData, filePath, { ...opts, timeoutMs }), timeout]);
      return { status: isEmpty(transcript) ? 'shadow_empty' : 'ok', errorClass: null, transcript, latencyMs: Date.now() - started };
    } catch (e) {
      const errorClass = classifyProviderError(e);
      return { status: errorClass === 'TIMEOUT' ? 'shadow_timeout' : 'shadow_error', errorClass, transcript: null, latencyMs: Date.now() - started };
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
}

async function transcribeWithShadow(d: SttDeps, fileData: Blob, filePath: string, opts: SttOptions, recordingId?: string): Promise<SttResult> {
  const shadow = startShadow(d, fileData, filePath, opts); // concurrent with the primary call, not awaited
  const t0 = Date.now();
  const primary = await d.deepgram.transcribe(fileData, filePath, opts); // a Deepgram failure behaves exactly as before
  const primaryLatencyMs = Date.now() - t0;

  if (shadow) {
    const run = (async () => {
      const outcome = await shadow;
      if (!outcome) return;
      const sh = outcome.transcript;
      const row: ShadowRunRow = {
        recording_id: recordingId ?? null,
        primary_provider: d.deepgram.name,
        primary_model: d.deepgram.model,
        shadow_provider: d.soniox.name,
        shadow_model: d.soniox.model,
        status: outcome.status,
        error_class: outcome.errorClass,
        primary_word_count: primary.wordCount,
        shadow_word_count: sh ? sh.wordCount : null,
        primary_duration_seconds: primary.durationSeconds ?? null,
        shadow_duration_seconds: sh ? sh.durationSeconds ?? null : null,
        primary_language: primary.detectedLanguage,
        shadow_language: sh ? sh.detectedLanguage : null,
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
