/**
 * Server-side text to speech for the in-meeting assistant. Output is MP3, which is what Recall's output_audio endpoint plays.
 *
 * Choice (documented in docs/VOICE_ASSISTANT.md): Deepgram Aura REST (`/v1/speak`) is the default. The backend already holds
 * DEEPGRAM_API_KEY for speech to text and it returns MP3 directly. Default voice is Aura-1 `aura-asteria-en`: measured 2026-11-09 from
 * a laptop, a one-sentence answer takes 0.13 to 0.23 s end to end, against 1.5 to 2.5 s for the Aura-2 voice (`aura-2-thalia-en`, which
 * synthesizes at about real time over REST). In a live call that gap is the whole difference between a snappy and a laggy answer.
 * Pick an Aura-2 voice with VOICE_ASSISTANT_TTS_VOICE if quality matters more than latency.
 * OpenAI `tts-1` is the fallback provider (the portfolio is moving off OpenAI, so it is opt-in via VOICE_ASSISTANT_TTS_PROVIDER).
 * macOS `say` from the prototype is not usable on Linux. The app-side TTS rules (ReadAloud / system TTS) are for client apps.
 *
 * Cost is an ESTIMATE: characters x VOICE_ASSISTANT_TTS_USD_PER_1K_CHARS.
 */
import type { VoiceAssistantConfig } from './config.js';

export interface SpeechAudio {
  b64: string;
  /** Playback length, parsed from the MP3 frames. */
  seconds: number;
  chars: number;
  usd: number;
  ms: number;
}

export type Synthesize = (text: string) => Promise<SpeechAudio>;

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Duration of an MP3 buffer in seconds, by walking the frame headers (Layer III). Falls back to 128 kbps if nothing parses. */
export function mp3DurationSeconds(buf: Buffer): number {
  let i = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    i = 10 + (((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f));
  }
  let seconds = 0;
  let frames = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1]! & 0xe0) !== 0xe0) { i++; continue; }
    const versionBits = (buf[i + 1]! >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layerBits = (buf[i + 1]! >> 1) & 3; // 1 = Layer III
    const brIdx = (buf[i + 2]! >> 4) & 15;
    const srIdx = (buf[i + 2]! >> 2) & 3;
    const pad = (buf[i + 2]! >> 1) & 1;
    if (versionBits === 1 || layerBits !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) { i++; continue; }
    const kbps = (versionBits === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[brIdx]!;
    const rate = SAMPLE_RATES[versionBits]![srIdx]!;
    const samples = versionBits === 3 ? 1152 : 576;
    const len = Math.floor(((versionBits === 3 ? 144 : 72) * kbps * 1000) / rate) + pad;
    if (len < 4) { i++; continue; }
    seconds += samples / rate;
    frames++;
    i += len;
  }
  return frames > 0 ? seconds : (buf.length * 8) / 128_000;
}

async function deepgram(text: string, cfg: VoiceAssistantConfig, fetchFn: typeof fetch): Promise<Buffer> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY is not configured');
  const model = cfg.ttsVoice || 'aura-asteria-en';
  const res = await fetchFn(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=mp3&bit_rate=48000`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw Object.assign(new Error(`Deepgram TTS error: ${res.status}`), { status: res.status });
  return Buffer.from(await res.arrayBuffer());
}

async function openai(text: string, cfg: VoiceAssistantConfig, fetchFn: typeof fetch): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not configured');
  const res = await fetchFn('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: cfg.ttsVoice || 'alloy', input: text, response_format: 'mp3' }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw Object.assign(new Error(`OpenAI TTS error: ${res.status}`), { status: res.status });
  return Buffer.from(await res.arrayBuffer());
}

export function createSynthesizer(getConfig: () => VoiceAssistantConfig, fetchFn: typeof fetch = fetch): Synthesize {
  return async (text: string): Promise<SpeechAudio> => {
    const cfg = getConfig();
    const clipped = text.slice(0, 1000);
    const t0 = Date.now();
    const audio = cfg.ttsProvider === 'openai' ? await openai(clipped, cfg, fetchFn) : await deepgram(clipped, cfg, fetchFn);
    if (audio.length < 200) throw new Error('TTS returned no audio');
    return {
      b64: audio.toString('base64'),
      seconds: mp3DurationSeconds(audio),
      chars: clipped.length,
      usd: (clipped.length / 1000) * cfg.ttsUsdPer1kChars,
      ms: Date.now() - t0,
    };
  };
}

/** Fixed phrases (intro, "Let me check", apology) are synthesized once per voice and kept for the life of the process. */
export function cachedPhrases(synth: Synthesize, getConfig: () => VoiceAssistantConfig): (text: string) => Promise<SpeechAudio> {
  const cache = new Map<string, Promise<SpeechAudio>>();
  return (text: string) => {
    const cfg = getConfig();
    const k = `${cfg.ttsProvider}|${cfg.ttsVoice}|${text}`;
    let p = cache.get(k);
    if (!p) {
      p = synth(text);
      cache.set(k, p);
      p.catch(() => cache.delete(k)); // do not cache a failure
    }
    return p;
  };
}

export const CUE_TEXT = 'Let me check.';
export const APOLOGY_TEXT = "Sorry, I couldn't get that. Please ask me again.";
export const LIMIT_TEXT = "I've reached my question limit for this meeting.";
export const INTRO_TEXT =
  "Hi, this is Meeting Mind. I'm recording this meeting. To ask me something, say Meeting Mind, then your question.";
