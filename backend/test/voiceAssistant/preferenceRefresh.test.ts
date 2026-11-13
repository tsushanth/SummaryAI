/**
 * The in-app switch (PUT /api/voice-assistant) must also work while a meeting is running: a session re-reads the user's
 * opt-out at most every PREFERENCE_REFRESH_MS, so turning it off silences the bot on the next event.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));
vi.mock('../../src/services/recallService.js', () => ({ RecallService: {} }));
vi.mock('../../src/config/index.js', () => ({ config: { ANTHROPIC_API_KEY: 'test', SUMMARY_MODEL: 'claude-haiku-4-5-20251001' } }));
vi.mock('../../src/lib/llm.js', () => ({ instrumentAnthropic: (c: any) => c, withFeature: (_n: string, fn: any) => fn() }));

import { VoiceAssistantManager, PREFERENCE_REFRESH_MS, type ManagerDeps } from '../../src/services/voiceAssistant/manager.js';
import { loadVoiceAssistantConfig } from '../../src/services/voiceAssistant/config.js';
import { VoiceMetrics } from '../../src/services/voiceAssistant/metrics.js';
import { answerOf, OWNER } from './world.js';

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

function makeManager() {
  const cfgEnv = { VOICE_ASSISTANT_MODE: 'all' } as NodeJS.ProcessEnv;
  const getConfig = () => loadVoiceAssistantConfig(cfgEnv);
  let t = 1_800_000_000_000;
  let pref: boolean | undefined = undefined;
  let prefFails = false;
  let prefReads = 0;
  const asked: string[] = [];
  const d: ManagerDeps = {
    getConfig, now: () => t, sleep: async (ms) => { t += ms; },
    lookupBot: async () => ({ botRunId: 'r', meetingId: 'm', userId: 'u', liveStt: false }),
    loadPreference: async () => { prefReads++; if (prefFails) throw new Error('db down'); return pref; },
    loadOwner: async () => ({ email: OWNER.email, names: [OWNER.name] }),
    loadSeed: async () => [],
    dataFor: () => ({} as any),
    answerer: async (i) => { asked.push(i.question); return answerOf('Friday.'); },
    synth: async (text) => ({ b64: `say:${text}`, seconds: 2, chars: text.length, usd: 0, ms: 1 }),
    phrase: async (text) => ({ b64: `phrase:${text}`, seconds: 1, chars: text.length, usd: 0, ms: 0 }),
    play: async () => {}, stop: async () => {},
    metrics: new VoiceMetrics({ getConfig, now: () => t, log: () => {}, alert: () => {}, pushUsage: null }),
  };
  const m = new VoiceAssistantManager(d);
  const ask = async (text = 'Meeting mind, what did we decide about the launch date?') => {
    await m.handle({
      event: 'transcript.data',
      data: { data: { words: text.split(' ').map((w, i) => ({ text: w, start_timestamp: { relative: i }, end_timestamp: { relative: i + 1 } })), participant: { id: 1, name: OWNER.name, is_host: false, email: OWNER.email } }, bot: { id: 'bot-1', metadata: {} } },
    } as any);
    await m.session('bot-1')?.whenIdle();
  };
  return {
    ask, asked, reads: () => prefReads,
    setPref: (v: boolean | undefined) => { pref = v; },
    failPref: (v: boolean) => { prefFails = v; },
    advance: (ms: number) => { t += ms; },
  };
}

describe('voice assistant: the in-app switch during a running meeting', () => {
  it('turning it off silences the next question once the refresh interval has passed', async () => {
    const x = makeManager();
    await x.ask();
    expect(x.asked).toHaveLength(1);
    x.setPref(false);
    x.advance(PREFERENCE_REFRESH_MS + 1);
    await x.ask('Meeting mind, what did we decide about the pricing page?');
    expect(x.asked).toHaveLength(1); // not answered
  });

  it('does not hit the database on every event (reads are throttled)', async () => {
    const x = makeManager();
    await x.ask();
    const before = x.reads();
    for (let i = 0; i < 5; i++) await x.ask('hello everyone');
    expect(x.reads()).toBe(before);
    x.advance(PREFERENCE_REFRESH_MS + 1);
    await x.ask('hello everyone');
    expect(x.reads()).toBe(before + 1);
  });

  it('a failed preference read keeps the last known value and never throws', async () => {
    const x = makeManager();
    await x.ask();
    x.failPref(true);
    x.advance(PREFERENCE_REFRESH_MS + 1);
    await expect(x.ask('Meeting mind, what did we decide about the pricing page?')).resolves.toBeUndefined();
    expect(x.asked).toHaveLength(2); // still on: last known value was "not opted out"
  });
});
