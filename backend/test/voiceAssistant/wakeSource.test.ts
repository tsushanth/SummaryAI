/**
 * VOICE_ASSISTANT_WAKE_SOURCE=live_stt: the wake phrase and the question come from the live-stt (Soniox) final segments.
 * The three scripted attempts replay what was observed in a live meeting (Recall low-latency stream vs the Soniox shadow stream).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));
vi.mock('../../src/services/recallService.js', () => ({ RecallService: {} }));
vi.mock('../../src/config/index.js', () => ({ config: { ANTHROPIC_API_KEY: 'test', SUMMARY_MODEL: 'claude-haiku-4-5-20251001' } }));
vi.mock('../../src/lib/llm.js', () => ({ instrumentAnthropic: (c: any) => c, withFeature: (_n: string, fn: any) => fn() }));

import { makeWorld, deferred, OWNER, GUEST } from './world.js';
import { VoiceAssistantManager, type ManagerDeps } from '../../src/services/voiceAssistant/manager.js';
import { loadVoiceAssistantConfig } from '../../src/services/voiceAssistant/config.js';
import { VoiceMetrics } from '../../src/services/voiceAssistant/metrics.js';
import { answerOf } from './world.js';

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

const LIVE = { VOICE_ASSISTANT_WAKE_SOURCE: 'live_stt' };
const questions = (w: { asked: Array<{ question: string }> }) => w.asked.map((a) => a.question);
const count = (w: { types: () => string[] }, type: string) => w.types().filter((t) => t === type).length;

/** The coalescing wait of a split question is released by the test, so segments can arrive "during" it. */
function gatedSleep(world: () => { advance: (ms: number) => void }) {
  const gate = deferred<void>();
  let first = true;
  const sleep = async (ms: number) => {
    if (first && ms === 1200) { first = false; await gate.promise; }
    world().advance(ms);
  };
  return { gate, sleep };
}

/** Attempt N exactly as the two streams delivered it. `recall` and `live` are in arrival order, each with a gap in ms. */
async function attempt1(w: ReturnType<typeof makeWorld>) {
  await w.sayLive(OWNER, 'Meeting mind, what did we talk about'); // Soniox final, about 1 s after speech end
  w.advance(4000);
  await w.say(OWNER, 'meeting mind what did we talk about'); // Recall final
}
async function attempt3(w: ReturnType<typeof makeWorld>) {
  await w.sayLive(OWNER, 'Meeting mind, what did we talk about in my last meeting in which you were involved?');
  w.advance(4000);
  await w.say(OWNER, 'what did we talk about in my last meeting in which you were involved'); // Recall dropped the leading words
}
async function attempt2(w: ReturnType<typeof makeWorld>, release: () => void) {
  await w.sayLive(OWNER, 'Meeting mind, what');
  await w.sayLive(OWNER, 'did we decide in my');
  await w.sayLive(OWNER, 'last meeting with Prajni?');
  release();
  w.advance(4000);
  await w.say(OWNER, 'meeting my invading we decided in my'); // Recall: garbled wake
  await w.say(OWNER, 'last meeting with prajni');
}

describe('replay of the three observed attempts', () => {
  it('wake source live_stt: all three wake phrases are recognised and each is answered once, with the whole question', async () => {
    let world!: ReturnType<typeof makeWorld>;
    const { gate, sleep } = gatedSleep(() => world);
    world = makeWorld(LIVE, { hasLiveStream: true, sleep });

    await attempt1(world);
    gate.resolve(); // attempt 1 has no continuation: the wait simply ends
    await world.session.whenIdle();

    world.advance(60_000);
    await attempt3(world);
    await world.session.whenIdle();

    // attempt 2 needs its own gate (the first wait has been used up)
    const g2 = gatedSleep(() => world);
    (world.deps as any).sleep = g2.sleep;
    world.advance(60_000);
    await attempt2(world, () => g2.gate.resolve());
    await world.session.whenIdle();

    expect(count(world, 'wake')).toBe(3);
    expect(count(world, 'question')).toBe(3);
    expect(count(world, 'answered')).toBe(3);
    expect(count(world, 'barge_in')).toBe(0);
    expect(questions(world)).toEqual([
      'what did we talk about',
      'what did we talk about in my last meeting in which you were involved?',
      'what did we decide in my last meeting with Prajni?',
    ]);
    expect(world.asked.every((a) => a.allowHistory && a.speakerName === OWNER.name)).toBe(true);
  });

  it('wake source recall (default): attempt 1 works, attempts 2 and 3 are missed, and live-stt events are ignored', async () => {
    const world = makeWorld({}, { hasLiveStream: true });
    await attempt1(world);
    await world.session.whenIdle();
    world.advance(60_000);
    await attempt3(world);
    world.advance(60_000);
    await attempt2(world, () => undefined);
    await world.session.whenIdle();
    // Only the Recall copy of attempt 1 can wake: the live-stt copies are not accepted at all under the default source.
    expect(count(world, 'wake')).toBe(1);
    expect(questions(world)).toEqual(['what did we talk about']);
  });
});

describe('both streams deliver the same question', () => {
  it('is answered once: no second question, no barge-in, one set of metrics', async () => {
    const world = makeWorld(LIVE, { hasLiveStream: true });
    await world.sayLive(OWNER, 'Meeting mind, what did we decide about the launch date?');
    await world.session.whenIdle();
    // The Recall copies arrive afterwards: partials while the bot is speaking, then the final.
    await world.say(OWNER, 'meeting mind what did we decide about', true);
    await world.say(OWNER, 'meeting mind what did we decide about the launch date', true);
    world.advance(4000);
    await world.say(OWNER, 'Meeting Mind what did we decide about the launch date');
    await world.session.whenIdle();
    expect(world.asked).toHaveLength(1);
    expect(count(world, 'wake')).toBe(1);
    expect(count(world, 'question')).toBe(1);
    expect(count(world, 'answered')).toBe(1);
    expect(count(world, 'barge_in')).toBe(0);
    expect(world.stops).toHaveLength(0);
    expect(world.spokenTexts()).toEqual(['Let me check.', 'You decided to ship on Friday.']);
  });

  it('Recall arriving FIRST changes nothing: the Recall final is not a question while the live-stt stream is up', async () => {
    const world = makeWorld(LIVE, { hasLiveStream: true });
    await world.sayLive(OWNER, 'okay so let us start'); // live-stt is known to be delivering
    await world.say(OWNER, 'Meeting Mind what did we decide about the launch date');
    await world.session.whenIdle();
    expect(world.asked).toHaveLength(0);
    await world.sayLive(OWNER, 'Meeting mind, what did we decide about the launch date?');
    await world.session.whenIdle();
    expect(world.asked).toHaveLength(1);
  });
});

describe('Recall events still interrupt', () => {
  it('a guest talking over the answer (Recall partial) and a stop word both stop the audio', async () => {
    const world = makeWorld(LIVE, { hasLiveStream: true }, );
    world.deps.synth = async (text) => ({ b64: `say:${text}`, seconds: 20, chars: text.length, usd: 0, ms: 1 });
    await world.sayLive(OWNER, 'Meeting mind, what did we decide about the launch date?');
    await world.session.whenIdle();
    expect(world.session.isSpeaking).toBe(true);
    await world.say(GUEST, 'sorry can I jump in here', true);
    expect(world.stops).toHaveLength(1);
    expect(world.types()).toContain('barge_in');
  });

  it('the asker\'s own late Recall partials never cancel the answer', async () => {
    const world = makeWorld(LIVE, { hasLiveStream: true });
    world.deps.synth = async (text) => ({ b64: `say:${text}`, seconds: 20, chars: text.length, usd: 0, ms: 1 });
    await world.sayLive(OWNER, 'Meeting mind, what did we decide about the launch date?');
    await world.session.whenIdle();
    world.advance(5000);
    await world.say(OWNER, 'meeting mind what did we stop deciding about the launch date', true); // lagging copy, even containing "stop"
    expect(world.stops).toHaveLength(0);
    expect(count(world, 'barge_in')).toBe(0);
  });

  it('a live-stt stop word or a new live-stt question interrupts, as a Recall final does today', async () => {
    const world = makeWorld(LIVE, { hasLiveStream: true });
    world.deps.synth = async (text) => ({ b64: `say:${text}`, seconds: 20, chars: text.length, usd: 0, ms: 1 });
    await world.sayLive(OWNER, 'Meeting mind, what did we decide about the launch date?');
    await world.session.whenIdle();
    world.advance(6000);
    await world.sayLive(GUEST, 'Stop.');
    expect(world.stops).toHaveLength(1);
  });
});

describe('fallback to Recall', () => {
  it('a bot without a live-stt stream behaves exactly as today, even with the flag on', async () => {
    const world = makeWorld(LIVE, { hasLiveStream: false });
    await world.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await world.session.whenIdle();
    expect(questions(world)).toEqual(['what did we decide about the launch date?']);
    expect(count(world, 'answered')).toBe(1);
    // live-stt events for such a bot are never accepted
    world.advance(60_000);
    await world.sayLive(OWNER, 'Meeting mind, what did we talk about today?');
    await world.session.whenIdle();
    expect(world.asked).toHaveLength(1);
  });

  it('a live-stt stream that stops delivering is replaced by Recall after three Recall finals in a row, and never answers twice', async () => {
    const world = makeWorld(LIVE, { hasLiveStream: true });
    await world.say(OWNER, 'okay let us start with the roadmap now');
    await world.say(GUEST, 'sounds good to me let us begin');
    await world.say(OWNER, 'Meeting Mind, what did we decide about the launch date?'); // third Recall final, no live-stt in between
    await world.session.whenIdle();
    expect(questions(world)).toEqual(['what did we decide about the launch date?']);
    // the live-stt copy of the same question turns up late: same wake from the other stream within 15 s is dropped
    world.advance(3000);
    await world.sayLive(OWNER, 'Meeting mind, what did we decide about the launch date?');
    await world.session.whenIdle();
    expect(world.asked).toHaveLength(1);
    expect(count(world, 'wake')).toBe(1);
    // and once live-stt delivers again, it is the source again
    world.advance(60_000);
    await world.sayLive(OWNER, 'right so next topic then');
    await world.say(OWNER, 'Meeting Mind, what is the budget for this project?');
    await world.session.whenIdle();
    expect(world.asked).toHaveLength(1);
  });
});

describe('echo guard and caps on the live-stt path', () => {
  it('the bot\'s own answer coming back through live-stt is suppressed and does not start a question', async () => {
    const world = makeWorld(LIVE, { hasLiveStream: true });
    await world.sayLive(OWNER, 'Meeting mind, what did we decide about the launch date?');
    await world.session.whenIdle();
    await world.sayLive(GUEST, 'you decided to ship on Friday');
    await world.sayLive({ name: 'Meeting Mind' }, 'You decided to ship on Friday.');
    await world.session.whenIdle();
    expect(world.asked).toHaveLength(1);
    expect(count(world, 'echo_suppressed')).toBe(1);
  });

  it('the per-meeting question cap applies to live-stt questions', async () => {
    const world = makeWorld({ ...LIVE, VOICE_ASSISTANT_MAX_QUESTIONS_PER_MEETING: '1' }, { hasLiveStream: true });
    await world.sayLive(OWNER, 'Meeting mind, what did we decide about the launch date?');
    await world.session.whenIdle();
    world.advance(60_000);
    await world.sayLive(OWNER, 'Meeting mind, what is the budget for this project?');
    await world.session.whenIdle();
    expect(world.asked).toHaveLength(1);
    expect(world.events.some((e) => e.type === 'cap_hit' && e.detail === 'meeting')).toBe(true);
  });

  it('the kill switch silences live-stt events too', async () => {
    const world = makeWorld({ ...LIVE, VOICE_ASSISTANT_KILL: '1' }, { hasLiveStream: true });
    await world.sayLive(OWNER, 'Meeting mind, what did we decide about the launch date?');
    await world.session.whenIdle();
    expect(world.asked).toHaveLength(0);
    expect(world.plays).toHaveLength(0);
  });

  it('privacy: no question or answer text in the metric events', async () => {
    const world = makeWorld(LIVE, { hasLiveStream: true });
    await world.sayLive(OWNER, 'Meeting mind, what did we decide about the launch date?');
    await world.session.whenIdle();
    expect(JSON.stringify(world.events)).not.toMatch(/launch|Friday|decide/i);
  });
});

describe('manager: live-stt segments reach the same session, with the speaker resolved from Recall', () => {
  function makeManager(env: Record<string, string>, liveStt: boolean) {
    const cfgEnv = { VOICE_ASSISTANT_MODE: 'all', ...env } as NodeJS.ProcessEnv;
    const getConfig = () => loadVoiceAssistantConfig(cfgEnv);
    let t = 1_800_000_000_000;
    const asked: Array<{ question: string; allowHistory: boolean }> = [];
    let lookups = 0;
    const d: ManagerDeps = {
      getConfig, now: () => t, sleep: async (ms) => { t += ms; },
      lookupBot: async () => { lookups++; return { botRunId: 'r', meetingId: 'm', userId: 'u', liveStt }; },
      loadPreference: async () => undefined,
      loadOwner: async () => ({ email: OWNER.email, names: [OWNER.name] }),
      loadSeed: async () => [],
      dataFor: () => ({} as any),
      answerer: async (i) => { asked.push({ question: i.question, allowHistory: i.allowHistory }); return answerOf('Friday.'); },
      synth: async (text) => ({ b64: `say:${text}`, seconds: 2, chars: text.length, usd: 0, ms: 1 }),
      phrase: async (text) => ({ b64: `phrase:${text}`, seconds: 1, chars: text.length, usd: 0, ms: 0 }),
      play: async () => {}, stop: async () => {},
      metrics: new VoiceMetrics({ getConfig, now: () => t, log: () => {}, alert: () => {}, pushUsage: null }),
    };
    const m = new VoiceAssistantManager(d);
    const recall = (name: string, text: string, email: string | null = null, partial = false) => m.handle({
      event: partial ? 'transcript.partial_data' : 'transcript.data',
      data: { data: { words: text.split(' ').map((w, i) => ({ text: w, start_timestamp: { relative: i }, end_timestamp: { relative: i + 1 } })), participant: { id: 1, name, is_host: false, email } }, bot: { id: 'bot-1', metadata: {} } },
    } as any);
    return { m, asked, lookups: () => lookups, recall };
  }
  const seg = (text: string, speakerName: string | null = OWNER.name) => ({ text, speakerName, isHost: false });

  it('owner_email policy: the email Recall reported for that name is what identifies the owner on the live-stt path', async () => {
    const x = makeManager({ ...LIVE, VOICE_ASSISTANT_HISTORY_POLICY: 'owner_email' }, true);
    await x.recall(OWNER.name, 'hello everyone', OWNER.email); // Recall names the participant with its email
    await x.m.handleLive('bot-1', [seg('Meeting mind, what did we decide about the launch date?')]);
    await x.m.session('bot-1')!.whenIdle();
    expect(x.asked).toEqual([{ question: 'what did we decide about the launch date?', allowHistory: true }]);
  });

  it('owner_email policy without a known email: history is denied (fails closed), the live-only answer still works', async () => {
    const x = makeManager({ ...LIVE, VOICE_ASSISTANT_HISTORY_POLICY: 'owner_email' }, true);
    await x.m.handleLive('bot-1', [seg('Meeting mind, what did we decide about the launch date?')]);
    await x.m.session('bot-1')!.whenIdle();
    expect(x.asked).toEqual([{ question: 'what did we decide about the launch date?', allowHistory: false }]);
  });

  it('segments of a batch are applied in order, and an empty speaker name is a null speaker', async () => {
    const x = makeManager(LIVE, true);
    await x.m.handleLive('bot-1', [seg('Meeting mind', null), seg('what did we decide about the launch date?', null)]);
    await x.m.session('bot-1')!.whenIdle();
    expect(x.asked).toEqual([{ question: 'what did we decide about the launch date?', allowHistory: false }]);
  });

  it('does nothing (not even a lookup) when the flag is the default, or the bot has no live-stt stream', async () => {
    const a = makeManager({}, true);
    expect(await a.m.handleLive('bot-1', [seg('Meeting mind, what did we decide about the launch date?')])).toEqual({ handled: false, reason: 'wake_source_recall' });
    expect(a.lookups()).toBe(0);
    const b = makeManager(LIVE, false);
    expect(await b.m.handleLive('bot-1', [seg('Meeting mind, what did we decide about the launch date?')])).toEqual({ handled: false, reason: 'no_live_stream' });
    expect(b.asked).toHaveLength(0);
  });

  it('kill switch and mode off are honoured', async () => {
    const x = makeManager({ ...LIVE, VOICE_ASSISTANT_KILL: '1' }, true);
    expect((await x.m.handleLive('bot-1', [seg('Meeting mind, hello there my friend')])).handled).toBe(false);
    const y = makeManager({ ...LIVE, VOICE_ASSISTANT_MODE: 'off' }, true);
    expect((await y.m.handleLive('bot-1', [seg('Meeting mind, hello there my friend')])).handled).toBe(false);
  });
});
