import WebSocket from 'ws';
import type { SttCloseInfo, SttConnectOptions, SttConnection, SttEngine, SttError, SttStreamHandlers, SttToken, SttUpdate } from './types.js';

/**
 * Soniox realtime WebSocket API. Verified 2026-11-03 against
 *   https://docs.soniox.com/stt/api-reference/websocket-api  (endpoint, config fields, response shape, 300 min cap)
 *   https://docs.soniox.com/stt/rt/connection-keepalive      ({"type":"keepalive"}, <= 20 s of silence)
 *   https://docs.soniox.com/stt/rt/error-handling            (error_type values, 413 max_duration_reached, 429 concurrency)
 *   https://docs.soniox.com/stt/rt/limits-and-quotas         (10 concurrent streams default)
 * Codec ideas (config frame, finalize, empty-frame end) follow a sibling project's streaming codec (copied in spirit, not imported).
 */

export const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const MAX_TERMS = 200;

export interface SonioxConfigInput extends Partial<SttConnectOptions> {
  model: string;
  /** Server-side endpoint detection (emits <end> and finalizes at pauses). Off by default: see segmenter + docs note on diarization. */
  endpointDetection?: boolean;
  /** max_endpoint_delay_ms (500-3000, server default 2000). */
  endpointMaxDelayMs?: number;
  /** Only for the deprecated in-frame auth mode. */
  apiKey?: string | undefined;
}

export function buildSonioxConfig(i: SonioxConfigInput): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    model: i.model,
    audio_format: 'pcm_s16le',
    sample_rate: 16000,
    num_channels: 1,
    enable_speaker_diarization: i.diarization ?? true,
    enable_language_identification: true,
    // Soniox says endpointing/finalize lowers diarization accuracy; we segment ourselves (see segmenter.ts).
    enable_endpoint_detection: i.endpointDetection ?? false,
  };
  if (i.endpointDetection && i.endpointMaxDelayMs) cfg.max_endpoint_delay_ms = i.endpointMaxDelayMs;
  if (i.languageHints && i.languageHints.length) cfg.language_hints = i.languageHints;
  if (i.terms && i.terms.length) cfg.context = { terms: i.terms.slice(0, MAX_TERMS) };
  if (i.apiKey) cfg.api_key = i.apiKey;
  return cfg;
}

export type SonioxParsed = { type: 'update'; update: SttUpdate } | { type: 'error'; error: SttError } | { type: 'ignore' };

function classify(code: number | null, type: string): SttError {
  const base = { code, type };
  if (code === 429) return { ...base, retryable: true, fatal: false, rateLimited: true };
  if (code === 401 || code === 402 || code === 403) return { ...base, retryable: false, fatal: true };
  if (code === 400) return { ...base, retryable: false, fatal: true };
  if (code === 413 || type === 'max_duration_reached') return { ...base, retryable: true, fatal: false, maxDuration: true };
  return { ...base, retryable: true, fatal: false };
}

const SAFE_TYPE = /^[A-Za-z][A-Za-z0-9_.-]{0,47}$/;

export function parseSonioxMessage(raw: string): SonioxParsed {
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return { type: 'ignore' };
  }
  if (!m || typeof m !== 'object') return { type: 'ignore' };
  if (m.error_code !== undefined || m.error_message !== undefined) {
    // Vendor prose can echo transcript text or a key: keep only the numeric code and a sanitized type.
    const code = typeof m.error_code === 'number' ? m.error_code : Number(m.error_code) || null;
    const type = typeof m.error_type === 'string' && SAFE_TYPE.test(m.error_type) ? m.error_type : 'unknown';
    return { type: 'error', error: classify(code, type) };
  }
  if (!Array.isArray(m.tokens) && m.finished !== true) return { type: 'ignore' };
  const tokens: SttToken[] = [];
  for (const t of m.tokens ?? []) {
    if (!t || typeof t.text !== 'string') continue;
    if (t.text === '<fin>' || t.text === '<end>') {
      tokens.push({ text: '', startMs: 0, endMs: 0, isFinal: true, control: t.text === '<end>' ? 'end' : 'fin' });
      continue;
    }
    const tok: SttToken = {
      text: t.text,
      startMs: typeof t.start_ms === 'number' ? t.start_ms : 0,
      endMs: typeof t.end_ms === 'number' ? t.end_ms : typeof t.start_ms === 'number' ? t.start_ms : 0,
      isFinal: t.is_final === true,
    };
    if (t.speaker !== undefined && t.speaker !== null) tok.speaker = String(t.speaker);
    if (typeof t.language === 'string') tok.language = t.language;
    if (typeof t.confidence === 'number') tok.confidence = t.confidence;
    tokens.push(tok);
  }
  const update: SttUpdate = { tokens };
  if (typeof m.final_audio_proc_ms === 'number') update.finalAudioProcMs = m.final_audio_proc_ms;
  if (typeof m.total_audio_proc_ms === 'number') update.totalAudioProcMs = m.total_audio_proc_ms;
  if (m.finished === true) update.finished = true;
  return { type: 'update', update };
}

export interface SonioxEngineOptions {
  apiKey: string;
  model?: string;
  url?: string;
  /** `header` (default, verified live 2026-11-03): Authorization: Bearer <key>; `config`: key in the first frame (deprecated, refused from 2027-01-15); `both`. */
  authMode?: 'header' | 'config' | 'both';
  connectTimeoutMs?: number;
  endpointDetection?: boolean;
  endpointMaxDelayMs?: number;
  /** Test hook: receives each underlying socket (the replay harness uses it to cut a live connection). */
  onSocket?: (ws: WebSocket) => void;
}

/** Real Soniox engine. The tests run the same class against a fake server in test/fakeSoniox.ts (url override). */
export class SonioxEngine implements SttEngine {
  readonly name = 'soniox';
  constructor(private readonly o: SonioxEngineOptions) {}

  connect(opts: SttConnectOptions, handlers: SttStreamHandlers): Promise<SttConnection> {
    const mode = this.o.authMode ?? 'header';
    const headers: Record<string, string> = {};
    if (mode === 'header' || mode === 'both') headers.Authorization = `Bearer ${this.o.apiKey}`;
    const ws = new WebSocket(this.o.url ?? SONIOX_URL, { headers, handshakeTimeout: this.o.connectTimeoutMs ?? 10_000, maxPayload: 4 * 1024 * 1024 });
    this.o.onSocket?.(ws);
    let settled = false;
    let closeReported = false;
    let lastError: SttError | undefined;
    const reportClose = (info: SttCloseInfo) => {
      if (closeReported) return;
      closeReported = true;
      try { handlers.onClose(info); } catch { /* handler bugs must not become unhandled errors */ }
    };

    return new Promise<SttConnection>((resolve, reject) => {
      const fail = (err: Error & { sttError?: SttError }) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      ws.on('open', () => {
        try {
          ws.send(JSON.stringify(buildSonioxConfig({
            model: this.o.model ?? 'stt-rt-v6', terms: opts.terms, languageHints: opts.languageHints, diarization: opts.diarization,
            endpointDetection: this.o.endpointDetection, endpointMaxDelayMs: this.o.endpointMaxDelayMs,
            apiKey: mode === 'header' ? undefined : this.o.apiKey,
          })));
        } catch (e) { fail(e as Error); return; }
        settled = true;
        resolve({
          sendAudio: (pcm) => { if (ws.readyState !== WebSocket.OPEN) throw new Error('soniox socket not open'); ws.send(pcm); },
          keepalive: () => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'keepalive' })); },
          finalize: () => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'finalize' })); },
          endStream: () => { if (ws.readyState === WebSocket.OPEN) ws.send(''); },
          close: () => { try { ws.close(); } catch { ws.terminate(); } },
        });
      });
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const p = parseSonioxMessage(data.toString());
        if (p.type === 'update') {
          try { handlers.onUpdate(p.update); } catch { /* see above */ }
        } else if (p.type === 'error') {
          lastError = p.error;
        }
      });
      ws.on('unexpected-response', (_req, res) => {
        const code = res.statusCode ?? null;
        res.resume();
        fail(Object.assign(new Error(`soniox handshake status ${code}`), { sttError: classify(code, 'handshake') }));
      });
      ws.on('error', (e) => { fail(e); });
      ws.on('close', (code) => {
        if (!settled) { fail(Object.assign(new Error(`soniox closed before open (${code})`), { sttError: lastError })); return; }
        // 1000 after our own endStream (finished message) is a clean close; anything else, or a server error frame, is a drop.
        reportClose({ clean: code === 1000 && !lastError, error: lastError });
      });
    });
  }
}
