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
 */
import { v4 as uuidv4 } from 'uuid';
import { reportProviderFailure, reportProviderHttpFailure } from '../../lib/alerts.js';
import { deepgramLanguageParam } from '../../lib/transcriptionLanguage.js';
import { countWords, type NormalizedTranscript, type SttOptions, type SttProvider, type TranscriptSegment } from './types.js';

export const READALOUD_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_TIMEOUT_MS = 16 * 60_000;

export interface ReadaloudProviderOptions {
  /** Default: env READALOUD_STT_URL, read at call time. No trailing slash needed. */
  baseUrl?: string;
  /** Default: env READALOUD_STT_TOKEN, read at call time. */
  token?: string;
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
  async function transcribe(fileData: Blob, filePath: string, opts: SttOptions = {}): Promise<NormalizedTranscript> {
    const baseUrl = (o.baseUrl ?? process.env.READALOUD_STT_URL ?? '').trim().replace(/\/+$/, '');
    const token = (o.token ?? process.env.READALOUD_STT_TOKEN ?? '').trim();
    if (!baseUrl || !token) throw new Error('READALOUD_STT_URL / READALOUD_STT_TOKEN are not set');

    const ext = filePath.split('.').pop()?.toLowerCase() || 'm4a';
    const contentType = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
    const timeoutMs = opts.timeoutMs ?? (Number(process.env.READALOUD_STT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
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
          body: fileData,
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
        const body = await response.text().catch(() => '');
        reportProviderHttpFailure('readaloud', response.status);
        throw Object.assign(new Error(`ReadAloud STT error: ${response.status} - ${body.slice(0, 200)}`), { status: response.status });
      }
      return mapReadaloudResponse(await response.json(), pinned ?? undefined);
    } finally {
      clearTimeout(timer);
    }
  }

  return { name: 'readaloud', model: READALOUD_MODEL, transcribe };
}

export const readaloudProvider: SttProvider = createReadaloudProvider();
