/**
 * Self-hosted Whisper batch adapter (candidate for the final transcript). OFF unless STT_PROVIDER=readaloud AND both
 * READALOUD_STT_URL and READALOUD_STT_TOKEN are set; with either missing the router falls back to Deepgram. Nothing in the
 * default configuration reads these variables or contacts this service.
 *
 * Talks to the worker's Deepgram-compatible prerecorded route:
 *   POST <READALOUD_STT_URL>/v1/listen?diarize=true&utterances=true&smart_format=true&(detect_language=true | language=<code>)
 *   Authorization: Bearer <READALOUD_STT_TOKEN>      body = raw audio bytes
 *   -> { metadata: { duration }, results: { channels: [{ detected_language, alternatives: [{ transcript }] }],
 *                                           utterances: [{ speaker, start, end, transcript, confidence }] } }
 * Known worker limits (the router falls back to Deepgram on any of them): request body cap, a wall-clock budget per request
 * that includes the upload, diarization refused above one hour of audio (HTTP 413), and cold starts of several seconds when
 * the worker has scaled to zero.
 *
 * Long recordings. The worker refuses diarized audio longer than about an hour, so inputs that would exceed a request are split
 * into equal parts of at most 55 minutes, sent one after another (never all in memory as separate copies: each part is a lazy
 * slice of the original Blob behind a rewritten header), and stitched back with time offsets. Splitting is only done for PCM WAV
 * input, where a cut is a byte offset on a sample boundary and the header can be rewritten exactly. Any other format (mp3, m4a,
 * mp4) is not split: if the caller says the recording is longer than one request, the provider declines (precheck) and the
 * caller uses its other provider; with no length hint the whole file is sent and the worker's own limit applies.
 *
 * Speakers across parts. The worker numbers speakers per request, so "speaker 1" in part 2 is not known to be the same person as
 * "speaker 1" in part 1, and nothing here tries to match them (that needs voice embeddings, which this adapter does not have).
 * Therefore: if every part contains a single speaker the parts are merged as one speaker; if any part has several speakers the
 * result is refused (an error, so the router falls back) unless the caller asks for part-local speakers, in which case speaker
 * indexes are made unique per part and a speaker is never merged with one from another part. A cut can also land inside a word,
 * which can lose or garble one word at each boundary.
 */
import { v4 as uuidv4 } from 'uuid';
import { reportProviderFailure, reportProviderHttpFailure } from '../../lib/alerts.js';
import { deepgramLanguageParam } from '../../lib/transcriptionLanguage.js';
import { countWords, type NormalizedTranscript, type SttOptions, type SttProvider, type TranscriptSegment } from './types.js';

export const READALOUD_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_TIMEOUT_MS = 16 * 60_000;
/** Longest part sent in one request (the worker's limit is about one hour). */
export const READALOUD_MAX_PART_SECONDS = 55 * 60;
/** More parts than this is not worth the latency; the provider declines instead. */
export const READALOUD_MAX_PARTS = 6;
const WAV_HEADER_SCAN_BYTES = 64 * 1024;

export interface WavInfo {
  /** Byte offset of the first sample in the file. */
  dataOffset: number;
  /** Bytes of sample data actually present (whole frames only). */
  dataBytes: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  blockAlign: number;
  durationSeconds: number;
}

/** Reads the header of a PCM WAV. Returns null for anything else (other formats, float, RF64, truncated or odd headers). */
export async function readWavInfo(blob: Blob): Promise<WavInfo | null> {
  try {
    const buf = Buffer.from(await blob.slice(0, WAV_HEADER_SCAN_BYTES).arrayBuffer());
    if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
    let fmt: { sampleRate: number; channels: number; bitsPerSample: number; blockAlign: number } | null = null;
    let pos = 12;
    while (pos + 8 <= buf.length) {
      const id = buf.toString('ascii', pos, pos + 4);
      const size = buf.readUInt32LE(pos + 4);
      const body = pos + 8;
      if (id === 'fmt ') {
        if (size < 16 || body + 16 > buf.length) return null;
        let tag = buf.readUInt16LE(body);
        if (tag === 0xfffe) {
          if (size < 40 || body + 26 > buf.length) return null;
          tag = buf.readUInt16LE(body + 24); // sub-format GUID starts with the format tag
        }
        if (tag !== 1) return null; // integer PCM only
        fmt = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), blockAlign: buf.readUInt16LE(body + 12), bitsPerSample: buf.readUInt16LE(body + 14) };
      } else if (id === 'data') {
        if (!fmt) return null;
        const { channels, sampleRate, bitsPerSample, blockAlign } = fmt;
        if (channels < 1 || sampleRate < 1 || bitsPerSample < 8 || blockAlign < 1 || blockAlign !== channels * (bitsPerSample / 8)) return null;
        const available = blob.size - body;
        // Streamed / unfinalised files carry 0 or 0xFFFFFFFF as the length: use what is there.
        const dataBytes = size === 0 || size === 0xffffffff || size > available ? available : size;
        const usable = dataBytes - (dataBytes % blockAlign);
        if (usable <= 0) return null;
        return { dataOffset: body, dataBytes: usable, sampleRate, channels, bitsPerSample, blockAlign, durationSeconds: usable / blockAlign / sampleRate };
      }
      pos = body + size + (size % 2);
    }
    return null;
  } catch {
    return null;
  }
}

/** Canonical 44-byte PCM header for `dataBytes` of samples in the same layout as `w`. */
export function buildWavHeader(w: Pick<WavInfo, 'sampleRate' | 'channels' | 'bitsPerSample' | 'blockAlign'>, dataBytes: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(w.channels, 22);
  h.writeUInt32LE(w.sampleRate, 24);
  h.writeUInt32LE(w.sampleRate * w.blockAlign, 28);
  h.writeUInt16LE(w.blockAlign, 32);
  h.writeUInt16LE(w.bitsPerSample, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

export interface PartPlan {
  /** Byte range inside the sample data (not the file). */
  start: number;
  end: number;
  offsetSeconds: number;
  durationSeconds: number;
}

/** Equal parts of at most `maxSeconds`, cut on sample boundaries. */
export function planParts(w: Pick<WavInfo, 'dataBytes' | 'blockAlign' | 'sampleRate'>, maxSeconds = READALOUD_MAX_PART_SECONDS): PartPlan[] {
  const frames = w.dataBytes / w.blockAlign;
  const n = Math.max(1, Math.ceil(frames / w.sampleRate / maxSeconds));
  const framesPerPart = Math.ceil(frames / n);
  const parts: PartPlan[] = [];
  for (let i = 0; i < n; i++) {
    const f0 = i * framesPerPart;
    const f1 = Math.min(frames, f0 + framesPerPart);
    if (f1 <= f0) break;
    parts.push({ start: f0 * w.blockAlign, end: f1 * w.blockAlign, offsetSeconds: f0 / w.sampleRate, durationSeconds: (f1 - f0) / w.sampleRate });
  }
  return parts;
}

export type ReadaloudPlan =
  | { kind: 'single' }
  | { kind: 'parts'; wav: WavInfo; parts: PartPlan[] }
  | { kind: 'skip'; reason: string };

/** Decides how an input is sent. Pure apart from reading the first bytes of a WAV. */
export async function planReadaloudInput(fileData: Blob, filePath: string, opts: SttOptions = {}, maxPartSeconds = READALOUD_MAX_PART_SECONDS): Promise<ReadaloudPlan> {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const wav = ext === 'wav' ? await readWavInfo(fileData) : null;
  if (wav) {
    if (wav.durationSeconds <= maxPartSeconds) return { kind: 'single' };
    const parts = planParts(wav, maxPartSeconds);
    if (parts.length > READALOUD_MAX_PARTS) return { kind: 'skip', reason: 'recording_too_long' };
    return { kind: 'parts', wav, parts };
  }
  const hint = Number(opts.durationHintSeconds);
  if (Number.isFinite(hint) && hint > maxPartSeconds) return { kind: 'skip', reason: 'long_recording_format_not_splittable' };
  return { kind: 'single' };
}

/** Thrown when parts disagree about who is speaking and the caller did not accept part-local speakers. */
export class ChunkedSpeakerIdentityError extends Error {
  constructor() {
    super('ReadAloud STT: multi-speaker audio was split into parts and speakers cannot be matched across parts');
    this.name = 'ChunkedSpeakerIdentityError';
  }
}

export interface TranscriptPart {
  transcript: NormalizedTranscript;
  offsetSeconds: number;
}

/**
 * Joins per-part transcripts into one, shifting segment times by each part's offset. Speaker policy is described at the top of
 * this file. `totalSeconds` is the known length of the whole input (used when a part has no measured duration).
 */
export function stitchParts(parts: TranscriptPart[], totalSeconds: number | null, allowPartLocalSpeakers: boolean): NormalizedTranscript {
  const distinct = (t: NormalizedTranscript) => new Set(t.segments.map((s) => s.speaker_index)).size;
  const multi = parts.some((p) => distinct(p.transcript) > 1);
  if (multi && !allowPartLocalSpeakers) throw new ChunkedSpeakerIdentityError();

  const segments: TranscriptSegment[] = [];
  let base = 0;
  let maxSpeakers = 1;
  parts.forEach((p, i) => {
    const local = [...new Set(p.transcript.segments.map((s) => s.speaker_index))].sort((a, b) => a - b);
    for (const s of p.transcript.segments) {
      const rank = local.indexOf(s.speaker_index);
      const index = multi ? base + rank : 0;
      segments.push({
        ...s,
        speaker_index: index,
        speaker_label: multi ? `Part ${i + 1} speaker ${rank}` : 'Speaker 0',
        start_time: s.start_time + p.offsetSeconds,
        end_time: s.end_time + p.offsetSeconds,
      });
    }
    base += local.length;
    maxSpeakers = Math.max(maxSpeakers, local.length);
  });

  const fullText = parts.map((p) => p.transcript.fullText.trim()).filter(Boolean).join(' ');
  const richest = parts.reduce((best, p) => (p.transcript.wordCount > best.transcript.wordCount ? p : best), parts[0]!);
  const measured = parts.map((p) => p.transcript.durationSeconds);
  const durationSeconds = measured.every((d) => typeof d === 'number' && d > 0) ? (measured as number[]).reduce((a, b) => a + b, 0) : totalSeconds;
  return {
    segments,
    fullText,
    wordCount: countWords(fullText),
    speakerCount: multi ? maxSpeakers : 1,
    detectedLanguage: richest.transcript.detectedLanguage,
    durationSeconds: durationSeconds ?? null,
  };
}

export interface ReadaloudProviderOptions {
  /** Default: env READALOUD_STT_URL, read at call time. No trailing slash needed. */
  baseUrl?: string;
  /** Default: env READALOUD_STT_TOKEN, read at call time. */
  token?: string;
  /** Longest part in seconds (default 55 minutes). Tests use small values. */
  maxPartSeconds?: number;
}

/** True when both variables are present. Used by the router to decide between the worker and the Deepgram fallback. */
export function isReadaloudConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.READALOUD_STT_URL?.trim() && !!env.READALOUD_STT_TOKEN?.trim();
}

/** Pure mapping from the worker's Deepgram-shaped JSON to the NormalizedTranscript shape. Throws when speech has no speaker turns. */
export function mapReadaloudResponse(result: any, pinnedLanguage?: string): NormalizedTranscript {
  const channel = result?.results?.channels?.[0];
  const fullText: string = channel?.alternatives?.[0]?.transcript || '';
  const utterances: any[] = Array.isArray(result?.results?.utterances) ? result.results.utterances : [];

  if (fullText.trim() && utterances.length === 0) {
    // A worker that silently ignored diarize (stale container) must not produce a one-speaker transcript for a meeting.
    throw new Error('ReadAloud STT returned text without speaker turns');
  }

  const segments: TranscriptSegment[] = utterances.map((u) => {
    const speaker = Number.isInteger(u.speaker) && u.speaker >= 0 ? u.speaker : 0;
    return {
      id: uuidv4(),
      speaker_label: `Speaker ${speaker}`,
      speaker_index: speaker,
      text: u.transcript || '',
      start_time: u.start || 0,
      end_time: u.end || 0,
      confidence: u.confidence || 0.9,
    };
  });

  const language = String(channel?.detected_language || pinnedLanguage || 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  const rawDuration = Number(result?.metadata?.duration);
  return {
    segments,
    fullText,
    wordCount: countWords(fullText),
    speakerCount: Math.max(1, new Set(segments.map((s) => s.speaker_index)).size),
    detectedLanguage: language,
    durationSeconds: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null,
  };
}

export function createReadaloudProvider(o: ReadaloudProviderOptions = {}): SttProvider {
  /** One request to the worker for one body (a whole file, or one part). Includes the pinned-language retry. */
  async function requestOnce(baseUrl: string, token: string, body: Blob, contentType: string, opts: SttOptions, timeoutMs: number): Promise<NormalizedTranscript> {
    const pinned = deepgramLanguageParam(opts.languageHints?.[0]);
    const terms = (opts.terms ?? []).map((t) => `&keyterm=${encodeURIComponent(t)}`).join('');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

    const post = async (languageQuery: string): Promise<Response> => {
      try {
        return await fetch(`${baseUrl}/v1/listen?diarize=true&utterances=true&smart_format=true&${languageQuery}${terms}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
          body,
          signal: controller.signal,
        });
      } catch (e) {
        const err = timedOut ? Object.assign(new Error(`ReadAloud STT timed out after ${timeoutMs}ms`), { name: 'TimeoutError' }) : e;
        reportProviderFailure('readaloud', err);
        throw err;
      }
    };

    try {
      let response = await post(pinned ? `language=${pinned}` : 'detect_language=true');
      if (pinned && response.status === 400) {
        console.warn('[ReadAloud STT] pinned language rejected; retrying with detect_language');
        response = await post('detect_language=true');
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        reportProviderHttpFailure('readaloud', response.status);
        throw Object.assign(new Error(`ReadAloud STT error: ${response.status} - ${text.slice(0, 200)}`), { status: response.status });
      }
      return mapReadaloudResponse(await response.json(), pinned ?? undefined);
    } finally {
      clearTimeout(timer);
    }
  }

  async function transcribe(fileData: Blob, filePath: string, opts: SttOptions = {}): Promise<NormalizedTranscript> {
    const baseUrl = (o.baseUrl ?? process.env.READALOUD_STT_URL ?? '').trim().replace(/\/+$/, '');
    const token = (o.token ?? process.env.READALOUD_STT_TOKEN ?? '').trim();
    if (!baseUrl || !token) throw new Error('READALOUD_STT_URL / READALOUD_STT_TOKEN are not set');

    const ext = filePath.split('.').pop()?.toLowerCase() || 'm4a';
    const contentType = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
    const perRequestMs = Number(process.env.READALOUD_STT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

    const plan = await planReadaloudInput(fileData, filePath, opts, o.maxPartSeconds);
    if (plan.kind === 'skip') throw Object.assign(new Error(`ReadAloud STT cannot take this input: ${plan.reason}`), { skipReason: plan.reason });
    if (plan.kind === 'single') return requestOnce(baseUrl, token, fileData, contentType, opts, opts.timeoutMs ?? perRequestMs);

    // Parts run one after another; the whole call shares one deadline and each request also has the per-request budget.
    const deadline = Date.now() + (opts.timeoutMs ?? perRequestMs * plan.parts.length);
    const done: TranscriptPart[] = [];
    for (const part of plan.parts) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const err = Object.assign(new Error('ReadAloud STT timed out before all parts were sent'), { name: 'TimeoutError' });
        reportProviderFailure('readaloud', err);
        throw err;
      }
      const body = new Blob([buildWavHeader(plan.wav, part.end - part.start), fileData.slice(plan.wav.dataOffset + part.start, plan.wav.dataOffset + part.end)], { type: 'audio/wav' });
      const transcript = await requestOnce(baseUrl, token, body, 'audio/wav', opts, Math.min(perRequestMs, remaining));
      done.push({ transcript, offsetSeconds: part.offsetSeconds });
      // Fail early: once one part has several speakers the merge is refused, so the remaining parts need not be transcribed.
      if (!opts.allowChunkLocalSpeakers && new Set(transcript.segments.map((s) => s.speaker_index)).size > 1) throw new ChunkedSpeakerIdentityError();
    }
    return stitchParts(done, plan.wav.durationSeconds, !!opts.allowChunkLocalSpeakers);
  }

  async function precheck(fileData: Blob, filePath: string, opts: SttOptions = {}): Promise<string | null> {
    try {
      const plan = await planReadaloudInput(fileData, filePath, opts, o.maxPartSeconds);
      return plan.kind === 'skip' ? plan.reason : null;
    } catch {
      return null;
    }
  }

  return { name: 'readaloud', model: READALOUD_MODEL, transcribe, precheck };
}

export const readaloudProvider: SttProvider = createReadaloudProvider();
