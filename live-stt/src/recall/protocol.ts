/**
 * Recall.ai real-time websocket messages we consume. Verified 2026-11-03 against
 *   https://docs.recall.ai/docs/how-to-get-mixed-audio-real-time.md   (audio_mixed_raw.data)
 *   https://docs.recall.ai/docs/real-time-websocket-endpoints.md      (event list, retry, auth)
 *   https://docs.recall.ai/docs/bot-real-time-transcription.md        (participant event payload)
 * Text frames only: { event, data: { data: { buffer(base64 s16le 16 kHz mono, 200 ms), timestamp: { relative(s), absolute } }, bot: { id } } }.
 * Participant events: data.data = { participant: { id:int, name|null, is_host|null, ... }, timestamp: { relative, absolute }, data: null }.
 * The older v1.10 protocol used binary frames; we reject those and count them (see invalidMessages).
 */

export const MAX_AUDIO_B64 = 256 * 1024; // a 200 ms chunk is ~8.5 KB base64; anything near this is not Recall audio

export interface Participant {
  id: string;
  name: string | null;
  isHost: boolean;
}

export type RecallInbound =
  | { kind: 'audio'; botId: string | null; relMs: number; durMs: number; pcm: Buffer }
  | { kind: 'empty'; botId: string | null; relMs: number }
  | { kind: 'speech'; on: boolean; botId: string | null; participant: Participant; relMs: number }
  | { kind: 'ignored'; event: string }
  | { kind: 'invalid'; reason: string };

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const BYTES_PER_MS = 32; // 16 kHz * 2 bytes / 1000

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseRecallMessage(raw: string | Buffer): RecallInbound {
  let msg: unknown;
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  } catch {
    return { kind: 'invalid', reason: 'json' };
  }
  if (!isObj(msg) || typeof msg.event !== 'string') return { kind: 'invalid', reason: 'shape' };
  const event = msg.event;
  const outer = isObj(msg.data) ? msg.data : {};
  const inner = isObj(outer.data) ? outer.data : {};
  const bot = isObj(outer.bot) ? outer.bot : {};
  const botId = typeof bot.id === 'string' && bot.id ? bot.id : null;
  const ts = isObj(inner.timestamp) ? inner.timestamp : null;
  const rel = ts && typeof ts.relative === 'number' && Number.isFinite(ts.relative) && ts.relative >= 0 ? ts.relative : null;

  if (event === 'audio_mixed_raw.data') {
    if (rel === null) return { kind: 'invalid', reason: 'timestamp' };
    const relMs = Math.round(rel * 1000);
    const b64 = inner.buffer;
    if (typeof b64 !== 'string') return { kind: 'invalid', reason: 'buffer' };
    if (b64.length === 0) return { kind: 'empty', botId, relMs };
    if (b64.length > MAX_AUDIO_B64 || b64.length % 4 !== 0 || !BASE64_RE.test(b64)) return { kind: 'invalid', reason: 'base64' };
    const pcm = Buffer.from(b64, 'base64');
    if (pcm.length === 0 || pcm.length % 2 !== 0) return { kind: 'invalid', reason: 'pcm_length' };
    return { kind: 'audio', botId, relMs, durMs: Math.round(pcm.length / BYTES_PER_MS), pcm };
  }

  if (event === 'participant_events.speech_on' || event === 'participant_events.speech_off') {
    const p = isObj(inner.participant) ? inner.participant : null;
    if (!p || rel === null || (typeof p.id !== 'number' && typeof p.id !== 'string')) return { kind: 'invalid', reason: 'participant' };
    return {
      kind: 'speech',
      on: event.endsWith('speech_on'),
      botId,
      participant: { id: String(p.id), name: typeof p.name === 'string' && p.name ? p.name : null, isHost: p.is_host === true },
      relMs: Math.round(rel * 1000),
    };
  }

  return { kind: 'ignored', event };
}
