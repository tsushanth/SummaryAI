/**
 * Soniox ASYNC transcription adapter (batch / final transcript path). Verified against docs.soniox.com AND live against
 * the real API on 2026-11-03 (model stt-async-v6 accepted; an unknown model gives 400 invalid_request "requested model is not
 * available"; recorded responses are in test/fixtures/stt/soniox-recorded-*). Real tokens also carry is_audio_event and
 * translation_status (both null). audio_duration_ms is already present while the job is still queued:
 *   POST   https://api.soniox.com/v1/files                          multipart `file`            -> 201 { id, filename, size, ... }
 *   POST   https://api.soniox.com/v1/transcriptions                 JSON { model, file_id, ... } -> 201 { id, status }
 *   GET    https://api.soniox.com/v1/transcriptions/{id}            status queued|processing|completed|error, audio_duration_ms, error_type
 *   GET    https://api.soniox.com/v1/transcriptions/{id}/transcript { id, text, tokens[{text,start_ms,end_ms,confidence,speaker,language}] }
 *   DELETE https://api.soniox.com/v1/transcriptions/{id} and /v1/files/{id}  -> 204
 * Auth: `Authorization: Bearer <SONIOX_API_KEY>`. Model: stt-async-v6 (v5 is removed 2026-12-15). Limits: 300 min per file.
 * Polling is used (not the webhook) because the processing job already holds the request open and needs no public URL.
 * Server-side copies of the audio and transcript are deleted as soon as the transcript is read (Soniox keeps them 30 days
 * otherwise). The upload uses a neutral file name, never the user's storage path.
 */
import { v4 as uuidv4 } from 'uuid';
import { reportProviderFailure, reportProviderHttpFailure } from '../../lib/alerts.js';
import { countWords, type NormalizedTranscript, type SttOptions, type SttProvider, type TranscriptSegment } from './types.js';

export const SONIOX_ASYNC_MODEL = 'stt-async-v6';
const DEFAULT_BASE_URL = 'https://api.soniox.com/v1';
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/** A silence this long inside one speaker's turn starts a new segment (Deepgram's utterances split on pauses too). */
const SEGMENT_GAP_MS = 1500;
/** After this much speech, split at the next sentence end; hard cap so one monologue is never a single huge segment. */
const SOFT_MAX_SEGMENT_MS = 45_000;
const HARD_MAX_SEGMENT_MS = 90_000;
const SENTENCE_END = /[.?!。？！]["')\]]?\s*$/;

export interface SonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  confidence?: number;
  speaker?: string | number;
  language?: string;
}

/** Soniox speakers are 1-based strings ("1", "2"); transcripts.speaker_names is keyed by the 0-based index Deepgram uses. */
function speakerIndexOf(speaker: unknown): number {
  const n = typeof speaker === 'number' ? speaker : typeof speaker === 'string' ? parseInt(speaker, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n - 1 : 0;
}

function languageOf(tokens: SonioxToken[]): string {
  const weight = new Map<string, number>();
  for (const t of tokens) {
    const code = String(t.language ?? '').toLowerCase().split(/[-_]/)[0];
    if (!code) continue;
    weight.set(code, (weight.get(code) ?? 0) + Math.max(1, t.text.trim().length));
  }
  let best = 'en';
  let bestW = 0;
  for (const [code, w] of weight) if (w > bestW) { best = code; bestW = w; }
  return best;
}

/** Pure mapping from Soniox tokens to the NormalizedTranscript shape. */
export function mapSonioxTokens(rawTokens: SonioxToken[], audioDurationMs: number | null | undefined): NormalizedTranscript {
  const tokens = (rawTokens || []).filter((t) => t && typeof t.text === 'string' && t.text !== '');

  const groups: SonioxToken[][] = [];
  let cur: SonioxToken[] = [];
  let curSpeaker = 0;
  let curStart = 0;
  let prevEnd = 0;
  for (const t of tokens) {
    const start = typeof t.start_ms === 'number' ? t.start_ms : prevEnd;
    const end = typeof t.end_ms === 'number' ? t.end_ms : start;
    const speaker = t.speaker === undefined || t.speaker === null ? curSpeaker : speakerIndexOf(t.speaker);
    if (cur.length > 0) {
      const spanMs = prevEnd - curStart;
      const prevText = cur[cur.length - 1].text;
      const atWordStart = /^\s/.test(t.text) || SENTENCE_END.test(prevText);
      const split =
        speaker !== curSpeaker ||
        start - prevEnd >= SEGMENT_GAP_MS ||
        (spanMs >= SOFT_MAX_SEGMENT_MS && SENTENCE_END.test(prevText)) ||
        (spanMs >= HARD_MAX_SEGMENT_MS && atWordStart);
      if (split) { groups.push(cur); cur = []; }
    }
    if (cur.length === 0) { curSpeaker = speaker; curStart = start; }
    cur.push({ ...t, start_ms: start, end_ms: end });
    prevEnd = end;
  }
  if (cur.length > 0) groups.push(cur);

  const segments: TranscriptSegment[] = [];
  for (const g of groups) {
    const text = g.map((t) => t.text).join('').trim();
    if (!text) continue;
    const confs = g.map((t) => t.confidence).filter((c): c is number => typeof c === 'number' && c > 0);
    const idx = speakerIndexOf(g[0].speaker);
    segments.push({
      id: uuidv4(),
      speaker_label: `Speaker ${idx}`,
      speaker_index: idx,
      text,
      start_time: (g[0].start_ms ?? 0) / 1000,
      end_time: (g[g.length - 1].end_ms ?? 0) / 1000,
      confidence: confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10000) / 10000 : 0.9,
    });
  }

  const fullText = segments.map((s) => s.text).join(' ');
  const speakerCount = Math.max(1, new Set(segments.map((s) => s.speaker_index)).size);

  let durationSeconds: number | null = null;
  if (typeof audioDurationMs === 'number' && audioDurationMs > 0) durationSeconds = audioDurationMs / 1000;
  else {
    const lastEnd = tokens.reduce((m, t) => Math.max(m, typeof t.end_ms === 'number' ? t.end_ms : 0), 0);
    if (lastEnd > 0) durationSeconds = lastEnd / 1000;
  }

  return { segments, fullText, wordCount: countWords(fullText), speakerCount, detectedLanguage: languageOf(tokens), durationSeconds };
}

/**
 * Process-wide cap on in-flight Soniox transcriptions (upload to delete). The Soniox key may be shared with other
 * products (VoxKey dictation uses the same account limits), so MeetingMind batch work must not flood it. Default 3,
 * override with SONIOX_MAX_CONCURRENT. Extra jobs wait in a FIFO queue; the per-call timeout starts after the wait.
 */
const DEFAULT_MAX_CONCURRENT = 3;
let activeJobs = 0;
const waiters: Array<() => void> = [];
const maxConcurrent = () => {
  const n = Number(process.env.SONIOX_MAX_CONCURRENT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_MAX_CONCURRENT;
};
async function acquireSlot(): Promise<() => void> {
  while (activeJobs >= maxConcurrent()) await new Promise<void>((r) => waiters.push(r));
  activeJobs++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeJobs--;
    waiters.shift()?.();
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SonioxProviderOptions {
  /** Default: env SONIOX_API_KEY, read at call time. */
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  pollIntervalMs?: number;
}

export function createSonioxProvider(o: SonioxProviderOptions = {}): SttProvider {
  const baseUrl = o.baseUrl ?? DEFAULT_BASE_URL;
  const pollIntervalMs = o.pollIntervalMs ?? 2000;

  async function transcribe(fileData: Blob, filePath: string, opts: SttOptions = {}): Promise<NormalizedTranscript> {
    const release = await acquireSlot();
    try {
      return await transcribeUnlimited(fileData, filePath, opts);
    } finally {
      release();
    }
  }

  async function transcribeUnlimited(fileData: Blob, filePath: string, opts: SttOptions = {}): Promise<NormalizedTranscript> {
    const apiKey = o.apiKey ?? process.env.SONIOX_API_KEY;
    if (!apiKey || !apiKey.trim()) throw new Error('SONIOX_API_KEY is not set');
    const model = o.model ?? process.env.SONIOX_ASYNC_MODEL ?? SONIOX_ASYNC_MODEL;
    const timeoutMs = opts.timeoutMs ?? (Number(process.env.SONIOX_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);

    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const auth = { Authorization: `Bearer ${apiKey}` };

    const timeoutError = () => {
      const e = new Error(`Soniox transcription timed out after ${timeoutMs}ms`);
      e.name = 'TimeoutError';
      return e;
    };
    const guard = (e: unknown): never => {
      const err = timedOut || Date.now() - startedAt > timeoutMs ? timeoutError() : e;
      reportProviderFailure('soniox', err);
      throw err;
    };

    async function call(method: string, path: string, init: { headers?: Record<string, string>; body?: any } = {}): Promise<any> {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${path}`, { method, headers: { ...auth, ...init.headers }, body: init.body, signal: controller.signal });
      } catch (e) {
        return guard(e);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        reportProviderHttpFailure('soniox', res.status);
        throw Object.assign(new Error(`Soniox API error: ${res.status} - ${body.slice(0, 200)}`), { status: res.status });
      }
      return res.json();
    }

    let fileId: string | undefined;
    let transcriptionId: string | undefined;
    try {
      // Neutral name: the storage path contains the user id and original file name.
      const rawExt = (filePath.split('.').pop() || '').toLowerCase();
      const ext = /^[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : 'm4a';
      const form = new FormData();
      form.append('file', fileData, `recording.${ext}`);
      fileId = (await call('POST', '/files', { body: form })).id;

      const create: Record<string, unknown> = {
        model,
        file_id: fileId,
        enable_speaker_diarization: true,
        // Parity with Deepgram detect_language: ~36% of completed recordings are not English.
        enable_language_identification: true,
      };
      if (opts.languageHints?.length) create.language_hints = opts.languageHints;
      if (opts.terms?.length) create.context = { terms: opts.terms };
      transcriptionId = (await call('POST', '/transcriptions', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(create) })).id;

      let audioDurationMs: number | null = null;
      for (;;) {
        if (timedOut || Date.now() - startedAt > timeoutMs) return guard(timeoutError());
        const st = await call('GET', `/transcriptions/${transcriptionId}`);
        if (typeof st.audio_duration_ms === 'number') audioDurationMs = st.audio_duration_ms;
        if (st.status === 'completed') break;
        if (st.status === 'error') {
          const err = Object.assign(new Error(`Soniox transcription failed: ${st.error_type || 'unknown'}`), { errorType: st.error_type });
          reportProviderFailure('soniox', err, { error_type: st.error_type });
          throw err;
        }
        await sleep(pollIntervalMs);
      }

      const tr = await call('GET', `/transcriptions/${transcriptionId}/transcript`);
      return mapSonioxTokens(Array.isArray(tr?.tokens) ? tr.tokens : [], audioDurationMs);
    } finally {
      clearTimeout(timer);
      // Best effort, own short deadline (the main signal may already be aborted). Never fails the call.
      for (const [kind, id] of [['transcriptions', transcriptionId], ['files', fileId]] as const) {
        if (!id) continue;
        try {
          await fetch(`${baseUrl}/${kind}/${id}`, { method: 'DELETE', headers: auth, signal: AbortSignal.timeout(10_000) });
        } catch {
          /* Soniox deletes everything after 30 days anyway */
        }
      }
    }
  }

  return {
    name: 'soniox',
    get model() { return o.model ?? process.env.SONIOX_ASYNC_MODEL ?? SONIOX_ASYNC_MODEL; },
    transcribe,
  };
}

export const sonioxProvider: SttProvider = createSonioxProvider();
