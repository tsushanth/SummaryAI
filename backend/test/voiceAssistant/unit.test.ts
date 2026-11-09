import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('../../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));

import { detectWake, isStopRequest, isEchoOf, cleanSpoken, stripWakePhrase, parseNotFound, isOwnerSpeaker } from '../../src/services/voiceAssistant/wake.js';
import { loadVoiceAssistantConfig, decideEnabled } from '../../src/services/voiceAssistant/config.js';
import { mp3DurationSeconds, createSynthesizer, cachedPhrases } from '../../src/services/voiceAssistant/tts.js';
import { fakeMp3 } from './world.js';
import { assistantWebhookToken, isValidAssistantToken, planVoiceAssistant } from '../../src/services/voiceAssistant/recallIntegration.js';

describe('wake phrase', () => {
  it.each([
    ['Meeting Mind, what did we decide?', 'what did we decide?'],
    ['meeting mind what did we decide', 'what did we decide'],
    ['Hey Meeting Mind, summarize so far', 'summarize so far'],
    ['okay, meeting-mine what is the plan', 'what is the plan'],
    ['So um Meeting Mind who said that', 'who said that'],
    ['Meeting Mind', ''],
  ])('opens an utterance: %s', (text, q) => {
    expect(detectWake(text)).toEqual({ question: q });
  });

  it.each([
    'I think Meeting Mind is a good name',
    'we should ask Meeting Mind about it',
    'the meeting mind map is on the wall',
    'Can you open the meeting notes',
    'meeting minutes were sent yesterday',
    '',
  ])('does not trigger: %s', (text) => {
    expect(detectWake(text)).toBeNull();
  });

  it('stop requests', () => {
    expect(isStopRequest('stop')).toBe(true);
    expect(isStopRequest('never mind')).toBe(true);
    expect(isStopRequest('Meeting Mind, never mind')).toBe(true);
    expect(isStopRequest('Meeting Mind, what did we stop doing last quarter')).toBe(false);
    expect(isStopRequest('what is the plan')).toBe(false);
  });

  it('wake phrase never survives into speech', () => {
    expect(stripWakePhrase('Meeting Mind found it. Ask meeting mind again.')).not.toMatch(/meeting mind/i);
    expect(cleanSpoken('**Bold** and `code` # heading', 100)).toBe('Bold and code heading');
  });

  it('NOT_FOUND marker', () => {
    expect(parseNotFound("NOT_FOUND: I don't see that.")).toEqual({ text: "I don't see that.", found: false });
    expect(parseNotFound('It is Friday.')).toEqual({ text: 'It is Friday.', found: true });
  });
});

describe('echo detection', () => {
  const spoken = 'You decided to ship on Friday and the budget was approved by Dana.';
  it('matches a recognition of the bot voice with small differences, or a cut-off', () => {
    expect(isEchoOf('you decided to ship on friday and the budget was approved by dana', spoken)).toBe(true);
    expect(isEchoOf('you decided to ship on Friday and the budget', spoken)).toBe(true);
    expect(isEchoOf('decided to ship on friday', spoken)).toBe(true);
  });
  it('does not match different talk or very short utterances', () => {
    expect(isEchoOf('what is the status of the hiring plan', spoken)).toBe(false);
    expect(isEchoOf('yes', spoken)).toBe(false);
    expect(isEchoOf('the budget', spoken)).toBe(false);
  });
});

describe('who is the owner', () => {
  const owner = { email: 'alex@example.com', names: ['Alex Owner'] };
  it('email match is strong; name match needs a full name (single names only for the host)', () => {
    expect(isOwnerSpeaker({ name: 'x', email: 'ALEX@example.com' }, owner)).toBe(true);
    expect(isOwnerSpeaker({ name: 'Alex Owner' }, owner)).toBe(true);
    expect(isOwnerSpeaker({ name: 'Alex Owner (Acme)' }, owner)).toBe(true);
    expect(isOwnerSpeaker({ name: 'Alex' }, owner)).toBe(false);
    expect(isOwnerSpeaker({ name: 'Alex', isHost: true }, owner)).toBe(true);
    expect(isOwnerSpeaker({ name: 'Alex Smith' }, owner)).toBe(false);
    expect(isOwnerSpeaker({ name: 'Gina Guest' }, owner)).toBe(false);
    expect(isOwnerSpeaker({ name: null }, owner)).toBe(false);
    expect(isOwnerSpeaker({ name: 'Alex Owner' }, owner, true)).toBe(false); // email-only policy
    expect(isOwnerSpeaker({ name: 'Alex Owner' }, { email: null, names: [] })).toBe(false);
  });
});

describe('flags and the kill switch', () => {
  const cfg = (env: Record<string, string>) => loadVoiceAssistantConfig(env as NodeJS.ProcessEnv);

  it('defaults: off, with the documented caps', () => {
    const c = cfg({});
    expect(c.mode).toBe('off');
    expect(c.killed).toBe(false);
    expect(c).toMatchObject({ maxQuestionsPerMeeting: 15, maxQuestionsPerUserPerDay: 40, maxAnswerChars: 450, dailySpendCapUsd: 10, historyPolicy: 'owner', intro: true, cue: true, ttsProvider: 'deepgram' });
  });

  it('garbage values fall back to the safe side and never throw', () => {
    const c = cfg({ VOICE_ASSISTANT_MODE: 'yes please', VOICE_ASSISTANT_MAX_QUESTIONS_PER_MEETING: '-3', VOICE_ASSISTANT_HISTORY_POLICY: 'whatever', VOICE_ASSISTANT_DAILY_SPEND_CAP_USD: 'abc' });
    expect(c).toMatchObject({ mode: 'off', maxQuestionsPerMeeting: 15, historyPolicy: 'owner', dailySpendCapUsd: 10 });
  });

  it('decision table', () => {
    const U = 'AAAA-1';
    expect(decideEnabled(cfg({}), U, true)).toEqual({ enabled: false, reason: 'mode_off' });
    expect(decideEnabled(cfg({ VOICE_ASSISTANT_MODE: 'all', VOICE_ASSISTANT_KILL: '1' }), U, true)).toEqual({ enabled: false, reason: 'killed' });
    expect(decideEnabled(cfg({ VOICE_ASSISTANT_MODE: 'all', VOICE_ASSISTANT_KILL: 'true' }), U, undefined).enabled).toBe(false);
    expect(decideEnabled(cfg({ VOICE_ASSISTANT_MODE: 'all' }), U, undefined)).toEqual({ enabled: true, reason: 'enabled' });
    expect(decideEnabled(cfg({ VOICE_ASSISTANT_MODE: 'all' }), U, false)).toEqual({ enabled: false, reason: 'user_opted_out' });
    expect(decideEnabled(cfg({ VOICE_ASSISTANT_MODE: 'opt_in' }), U, undefined)).toEqual({ enabled: false, reason: 'not_opted_in' });
    expect(decideEnabled(cfg({ VOICE_ASSISTANT_MODE: 'opt_in' }), U, true)).toEqual({ enabled: true, reason: 'enabled' });
    expect(decideEnabled(cfg({ VOICE_ASSISTANT_MODE: 'opt_in', VOICE_ASSISTANT_USER_IDS: 'x, aaaa-1' }), U, undefined).enabled).toBe(true);
    expect(decideEnabled(cfg({ VOICE_ASSISTANT_MODE: 'opt_in', VOICE_ASSISTANT_USER_IDS: 'aaaa-1' }), U, false).enabled).toBe(false);
    expect(decideEnabled(cfg({ VOICE_ASSISTANT_MODE: 'all' }), undefined, undefined).enabled).toBe(false);
  });
});

describe('TTS', () => {
  it('reads the playback length from the MP3 frames', () => {
    expect(mp3DurationSeconds(fakeMp3(100))).toBeCloseTo(100 * 1152 / 44100, 3);
    expect(mp3DurationSeconds(Buffer.alloc(16_000))).toBeCloseTo(1, 1); // no frames: 128 kbps fallback
  });

  afterEach(() => { delete process.env.DEEPGRAM_API_KEY; });

  it('Deepgram request: mp3, the key only in the Authorization header; cost estimate from characters', async () => {
    process.env.DEEPGRAM_API_KEY = 'dg-test-key';
    const calls: any[] = [];
    const fetchFn = (async (url: string, init: any) => { calls.push({ url, init }); return new Response(fakeMp3(40), { status: 200 }); }) as unknown as typeof fetch;
    const synth = createSynthesizer(() => loadVoiceAssistantConfig({}), fetchFn);
    const a = await synth('Friday is the launch.');
    expect(calls[0].url).toMatch(/^https:\/\/api\.deepgram\.com\/v1\/speak\?model=aura-asteria-en&encoding=mp3/);
    expect(calls[0].init.headers.Authorization).toBe('Token dg-test-key');
    expect(JSON.parse(calls[0].init.body)).toEqual({ text: 'Friday is the launch.' });
    expect(a.seconds).toBeGreaterThan(1);
    expect(a.usd).toBeCloseTo(21 / 1000 * 0.015, 6);
  });

  it('a provider error is thrown (the session turns it into a tts failure); fixed phrases are cached, failures are not', async () => {
    process.env.DEEPGRAM_API_KEY = 'dg-test-key';
    let n = 0;
    const fetchFn = (async () => (++n === 1 ? new Response('no', { status: 503 }) : new Response(fakeMp3(10), { status: 200 }))) as unknown as typeof fetch;
    const phrase = cachedPhrases(createSynthesizer(() => loadVoiceAssistantConfig({}), fetchFn), () => loadVoiceAssistantConfig({}));
    await expect(phrase('Let me check.')).rejects.toThrow(/503/);
    await new Promise((r) => setImmediate(r));
    await phrase('Let me check.');
    await phrase('Let me check.');
    expect(n).toBe(2);
  });
});

describe('createBot wiring (planVoiceAssistant)', () => {
  const base = { userId: 'user-1', serviceUrl: 'https://api.example.com', internalSecret: 'internal-secret-value', realtimeRecallTranscript: true, preference: async () => undefined, intro: async () => 'SU5UUk8=' };
  const withEnv = async (env: Record<string, string>, fn: () => Promise<void>) => {
    const keys = Object.keys(env);
    const old = keys.map((k) => process.env[k]);
    keys.forEach((k) => { process.env[k] = env[k]; });
    try { await fn(); } finally { keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; }); }
  };

  it('off by default: the bot is created exactly as before', async () => {
    await withEnv({}, async () => { expect(await planVoiceAssistant(base)).toBeNull(); });
  });

  it('mode all: adds a signed endpoint and the intro; the token is an HMAC of INTERNAL_SECRET, not the secret', async () => {
    await withEnv({ VOICE_ASSISTANT_MODE: 'all' }, async () => {
      const plan = (await planVoiceAssistant(base))!;
      expect(plan.endpoint.url).toBe(`https://api.example.com/v1/webhooks/recall-assistant?vt=${assistantWebhookToken('internal-secret-value')}`);
      expect(plan.endpoint.url).not.toContain('internal-secret-value');
      expect(plan.endpoint.events).toEqual(['transcript.data', 'transcript.partial_data']);
      expect(plan.automaticAudioOutput).toEqual({ in_call_recording: { data: { kind: 'mp3', b64_data: 'SU5UUk8=' } } });
    });
  });

  it('kill switch, opt-out, missing secret, no realtime transcript: no assistant', async () => {
    await withEnv({ VOICE_ASSISTANT_MODE: 'all', VOICE_ASSISTANT_KILL: '1' }, async () => { expect(await planVoiceAssistant(base)).toBeNull(); });
    await withEnv({ VOICE_ASSISTANT_MODE: 'all' }, async () => {
      expect(await planVoiceAssistant({ ...base, preference: async () => false })).toBeNull();
      expect(await planVoiceAssistant({ ...base, internalSecret: undefined })).toBeNull();
      expect(await planVoiceAssistant({ ...base, realtimeRecallTranscript: false })).toBeNull();
      expect(await planVoiceAssistant({ ...base, userId: undefined })).toBeNull();
    });
  });

  it('intro off or unavailable: still gets the endpoint, no audio field', async () => {
    await withEnv({ VOICE_ASSISTANT_MODE: 'all', VOICE_ASSISTANT_INTRO: 'false' }, async () => {
      expect((await planVoiceAssistant(base))!.automaticAudioOutput).toBeUndefined();
    });
    await withEnv({ VOICE_ASSISTANT_MODE: 'all' }, async () => {
      expect((await planVoiceAssistant({ ...base, intro: async () => null }))!.automaticAudioOutput).toBeUndefined();
    });
  });

  it('a throwing preference lookup never blocks the bot', async () => {
    await withEnv({ VOICE_ASSISTANT_MODE: 'all' }, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await planVoiceAssistant({ ...base, preference: async () => { throw new Error('db'); } })).toBeNull();
    });
  });

  it('token validation is exact', () => {
    const t = assistantWebhookToken('s');
    expect(isValidAssistantToken(t, 's')).toBe(true);
    expect(isValidAssistantToken(t.slice(0, -1) + '0', 's')).toBe(t.endsWith('0'));
    expect(isValidAssistantToken(undefined, 's')).toBe(false);
    expect(isValidAssistantToken(t, undefined)).toBe(false);
    expect(isValidAssistantToken(createHmac('sha256', 'other').update('x').digest('hex').slice(0, 40), 's')).toBe(false);
  });
});
