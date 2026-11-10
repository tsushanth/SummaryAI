/** Shared fakes for the voice assistant tests: deterministic clock, fake Recall playback, fake TTS, scripted answers. */
import { VoiceMetrics, type VaEvent } from '../../src/services/voiceAssistant/metrics.js';
import { loadVoiceAssistantConfig, type VoiceAssistantConfig } from '../../src/services/voiceAssistant/config.js';
import { VoiceSession, type SessionDeps } from '../../src/services/voiceAssistant/session.js';
import type { AgentResult } from '../../src/services/voiceAssistant/agent.js';

export const OWNER = { name: 'Alex Owner', email: 'alex@example.com' };
export const GUEST = { name: 'Gina Guest', email: null as string | null };

export interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

export function answerOf(text: string, extra: Partial<AgentResult> = {}): AgentResult {
  return { text, found: true, tools: ['get_live_meeting'], llmMs: 700, usd: 0.002, inputTokens: 1500, outputTokens: 40, ...extra };
}

export function makeWorld(env: Record<string, string> = {}, opts: { introPlayed?: boolean; answer?: SessionDeps['answer']; hasLiveStream?: boolean; sleep?: SessionDeps['sleep'] } = {}) {
  let t = 1_800_000_000_000;
  const cfgEnv = { VOICE_ASSISTANT_MODE: 'all', ...env };
  const cfg = (): VoiceAssistantConfig => loadVoiceAssistantConfig(cfgEnv as NodeJS.ProcessEnv);
  const events: VaEvent[] = [];
  const alerts: Array<[string, string]> = [];
  const metrics = new VoiceMetrics({
    getConfig: cfg, now: () => t, log: (l) => { events.push(JSON.parse(l)); }, alert: (f, c) => { alerts.push([f, c]); }, pushUsage: null,
  });
  const plays: Array<{ b64: string; at: number }> = [];
  const stops: number[] = [];
  const asked: Array<{ question: string; allowHistory: boolean; speakerName: string }> = [];
  const custom = opts.answer;
  const w = {
    cfgEnv, metrics, events, alerts, plays, stops, asked,
    now: () => t,
    advance: (ms: number) => { t += ms; },
    failPlay: false,
    failStop: false,
    synthFails: false,
    answer: (async (input) => {
      asked.push({ question: input.question, allowHistory: input.allowHistory, speakerName: input.speakerName });
      return custom ? custom(input) : answerOf('You decided to ship on Friday.');
    }) as SessionDeps['answer'],
  };
  const deps: SessionDeps = {
    userId: 'user-A', meetingId: 'meeting-1', botName: 'Meeting Mind', cfg, now: () => t,
    sleep: opts.sleep ?? (async (ms) => { t += ms; }),
    enabled: () => cfg().mode !== 'off' && !cfg().killed,
    isOwner: (s) => s.name === OWNER.name || s.email === OWNER.email,
    isOwnerEmailMatch: (s) => s.email === OWNER.email,
    answer: (input) => w.answer(input as any),
    synth: async (text) => { if (w.synthFails) throw new Error('tts down'); return { b64: `say:${text}`, seconds: 3, chars: text.length, usd: 0.0003, ms: 120 }; },
    phrase: async (text) => ({ b64: `phrase:${text}`, seconds: 1, chars: text.length, usd: 0, ms: 0 }),
    play: async (b64) => { if (w.failPlay) throw new Error('recall down'); plays.push({ b64, at: t }); },
    stop: async () => { if (w.failStop) throw new Error('stop failed'); stops.push(t); },
    metrics,
    introPlayed: opts.introPlayed ?? false,
    hasLiveStream: opts.hasLiveStream ?? false,
  };
  const session = new VoiceSession(deps);
  const say = async (speaker: { name: string | null; email?: string | null; isHost?: boolean }, text: string, partial = false) => {
    await new Promise((r) => setImmediate(r)); // let the cached fixed phrases (cue) resolve
    await session.onTranscript({ speaker, text, partial });
  };
  /** One event of the live-stt (Soniox) stream. Same speaker shape as say(); always a final unless `partial`. */
  const sayLive = async (speaker: { name: string | null; email?: string | null; isHost?: boolean }, text: string) => {
    await new Promise((r) => setImmediate(r));
    await session.onTranscript({ speaker, text, partial: false, source: 'live_stt' });
  };
  const spokenTexts = () => plays.map((p) => p.b64.replace(/^(say|phrase):/, ''));
  const types = () => events.map((e) => e.type);
  return Object.assign(w, { session, say, sayLive, spokenTexts, types, deps, cfg });
}

/** n valid MPEG-1 Layer III frames, 128 kbps, 44.1 kHz (417 bytes each, 26.12 ms each). */
export function fakeMp3(frames: number): Buffer {
  const f = Buffer.alloc(417);
  f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x00;
  return Buffer.concat(Array.from({ length: frames }, () => f));
}

