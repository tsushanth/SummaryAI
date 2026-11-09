/**
 * Replayed-transcript integration test: fake Recall real-time webhook events go through the real Express route, the real
 * manager / session / agent / TTS client / Recall client. Only the network (Recall, Deepgram, Anthropic) and the database are fakes.
 * The Recall bot is a fake that records what it was told to play or stop.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { makeFakeDb } from './fakeDb.js';
import { fakeMp3 } from './world.js';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL = 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY = 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy';
process.env.RECALL_API_KEY = 'recall-test-key';
process.env.RECALL_REGION = 'us-west-2';
process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
process.env.DEEPGRAM_API_KEY = 'deepgram-test-key';
process.env.INTERNAL_SECRET = 'internal-secret-for-tests';
process.env.SERVICE_URL = 'https://backend.example.test';
process.env.VOICE_ASSISTANT_MODE = 'all';
delete process.env.VOICE_ASSISTANT_KILL;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const rec = (id: string, user: string, title: string, day: string) => ({ id, user_id: user, title, created_at: `${day}T10:00:00Z`, duration_seconds: 1800, status: 'completed' });
const TABLES: Record<string, any[]> = {
  bot_runs: [
    { id: 'run-a', recall_bot_id: 'bot-A', meeting_id: 'meet-a', user_id: A },
    { id: 'run-b', recall_bot_id: 'bot-B', meeting_id: 'meet-b', user_id: B },
  ],
  profiles: [
    { id: A, email: 'alex@example.com', display_name: 'Alex Owner', preferences: {} },
    { id: B, email: 'bea@example.com', display_name: 'Bea Other', preferences: { voice_assistant: true } },
  ],
  live_transcripts: [],
  recordings: [rec('a1', A, 'Alpha roadmap review', '2026-10-01'), rec('b1', B, 'Bravo budget call', '2026-10-02')],
  transcripts: [
    { recording_id: 'a1', full_text: 'Alex: the launch is on Friday, March roadmap agreed.' },
    { recording_id: 'b1', full_text: 'Bea: the launch budget is 40k.' },
  ],
  summaries: [],
};
const db = makeFakeDb(TABLES);
vi.mock('../../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (t: string) => db.db.from(t),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: TABLES.profiles!.find((p) => p.id === id)?.email, user_metadata: {} } } }) } },
  },
}));

const recall: Array<{ method: string; path: string; b64?: string }> = [];
const llmRequests: any[] = [];
const speakRequests: string[] = [];
const realFetch = globalThis.fetch;

function stubNetwork() {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    if (u.includes('.recall.ai/api/v1/bot/') && u.includes('/output_audio/')) {
      recall.push({ method: init.method, path: u, b64: init.body ? JSON.parse(init.body).b64_data : undefined });
      return new Response('{}', { status: 200 });
    }
    if (u.includes('.recall.ai/api/v1/bot') && init.method === 'POST') {
      recall.push({ method: 'POST', path: '/bot', b64: init.body });
      return new Response(JSON.stringify({ id: 'bot-new', status: 'ready', meeting_url: 'x' }), { status: 200 });
    }
    if (u.startsWith('https://api.deepgram.com/v1/speak')) {
      const text = JSON.parse(init.body).text as string;
      speakRequests.push(text);
      return new Response(fakeMp3(text.length > 20 ? 100 : 8), { status: 200 });
    }
    if (u.startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(init.body);
      llmRequests.push(body);
      const lastUser = body.messages[body.messages.length - 1];
      const hasResult = Array.isArray(lastUser.content) && lastUser.content.some((c: any) => c.type === 'tool_result');
      const historyAllowed = body.tools.some((t: any) => t.name === 'search_transcripts');
      const content = historyAllowed && !hasResult
        ? [{ type: 'tool_use', id: 'tu1', name: 'search_transcripts', input: { query: 'launch' } }]
        : [{ type: 'text', text: historyAllowed ? 'The launch is on Friday, from your roadmap review.' : 'NOT_FOUND: I can only look up past meetings for the account owner.' }];
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content, stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn', usage: { input_tokens: 1200, output_tokens: 30 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, init); // the local test server
  }));
}

let server: Server;
let base = '';
let token = '';

const event = (bot: string, name: string, text: string, partial = false, extra: Record<string, unknown> = {}) => ({
  event: partial ? 'transcript.partial_data' : 'transcript.data',
  data: {
    data: { words: text.split(' ').map((w, i) => ({ text: w, start_timestamp: { relative: i }, end_timestamp: { relative: i + 1 } })), participant: { id: 1, name, is_host: false, email: null, ...extra } },
    bot: { id: bot, metadata: {} }, realtime_endpoint: { id: 'e', metadata: {} }, transcript: { id: 't', metadata: {} }, recording: { id: 'r', metadata: {} },
  },
});
const post = async (body: unknown, vt: string | null = token) => {
  const res = await realFetch(`${base}/webhooks/recall-assistant${vt === null ? '' : `?vt=${vt}`}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
};
const settle = async (ms = 400) => { await new Promise((r) => setTimeout(r, ms)); };
const plays = (bot?: string) => recall.filter((r) => r.method === 'POST' && r.path.includes('/output_audio/') && (!bot || r.path.includes(`/bot/${bot}/`)));

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  stubNetwork();
  const { voiceAssistantWebhookRouter } = await import('../../src/routes/voiceAssistant.js');
  const { assistantWebhookToken } = await import('../../src/services/voiceAssistant/recallIntegration.js');
  token = assistantWebhookToken(process.env.INTERNAL_SECRET!);
  const { voiceAssistantInternalRouter } = await import('../../src/routes/voiceAssistant.js');
  const app = express();
  app.use('/internal/voice-assistant', voiceAssistantInternalRouter);
  app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use('/webhooks/recall-assistant', voiceAssistantWebhookRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); vi.unstubAllGlobals(); });
beforeEach(() => { recall.length = 0; llmRequests.length = 0; speakRequests.length = 0; delete process.env.VOICE_ASSISTANT_KILL; });

describe('webhook authentication', () => {
  it('rejects a delivery without the token or a signature, and with a wrong token', async () => {
    expect((await post(event('bot-A', 'Alex Owner', 'Meeting Mind what is the plan today'), null)).status).toBe(401);
    expect((await post(event('bot-A', 'Alex Owner', 'Meeting Mind what is the plan today'), 'f'.repeat(40))).status).toBe(401);
    await settle(100);
    expect(plays()).toHaveLength(0);
    expect(llmRequests).toHaveLength(0);
  });
});

describe('replayed meeting', () => {
  it('ordinary talk is ignored; the owner\'s wake phrase gets a cue and an answer; talking over it stops the audio; the echo is ignored', async () => {
    // 1. Chatter, with partials: nothing happens.
    await post(event('bot-A', 'Alex Owner', 'okay so', true));
    await post(event('bot-A', 'Alex Owner', 'okay so let us start with the roadmap'));
    await post(event('bot-A', 'Gina Guest', 'I use Meeting Mind at my other job'));
    await settle(100);
    expect(plays()).toHaveLength(0);
    expect(llmRequests).toHaveLength(0);

    // 2. The owner asks (partials first, then the final).
    await post(event('bot-A', 'Alex Owner', 'Meeting Mind what', true));
    await post(event('bot-A', 'Alex Owner', 'Meeting Mind what did we decide about the launch'));
    await settle(1200);
    const first = plays('bot-A');
    expect(first).toHaveLength(2); // cue, then answer
    expect(speakRequests).toContain('Let me check.');
    expect(speakRequests.some((t) => t.includes('launch is on Friday'))).toBe(true);
    expect(speakRequests.some((t) => /meeting mind/i.test(t.replace(/^Hi, this is Meeting Mind\..*/, '')))).toBe(false); // no wake phrase in speech (except the fixed intro)
    // The owner was recognised by the profile name: history tools were offered and the owner's own meeting reached the model.
    expect(llmRequests[0].tools.map((t: any) => t.name)).toContain('search_transcripts');
    expect(JSON.stringify(llmRequests[0])).toContain('Alpha roadmap review');
    expect(JSON.stringify(llmRequests)).not.toContain('Bravo budget call'); // another user's data never appears

    // 3. The bot's voice comes back through the meeting audio: no re-trigger.
    const before = llmRequests.length;
    await post(event('bot-A', 'Meeting Mind', 'The launch is on Friday, from your roadmap review.'));
    await post(event('bot-A', 'Gina Guest', 'the launch is on Friday from your roadmap review'));
    await settle(150);
    expect(llmRequests).toHaveLength(before);

    // 4. Someone talks over the answer: Recall is told to stop.
    await post(event('bot-A', 'Gina Guest', 'sorry can I interrupt for a second', true));
    await settle(100);
    expect(recall.some((r) => r.method === 'DELETE' && r.path.includes('/bot/bot-A/output_audio/'))).toBe(true);
  });

  it('a guest asking about the past gets no history, only the fixed refusal sentence', async () => {
    await post(event('bot-A', 'Gina Guest', 'Meeting Mind what did Alex decide in the roadmap review last week'));
    await settle(1200);
    expect(llmRequests.length).toBeGreaterThanOrEqual(1);
    expect(llmRequests[0].tools.map((t: any) => t.name)).toEqual(['get_live_meeting']);
    expect(JSON.stringify(llmRequests[0])).not.toContain('Alpha roadmap review');
    expect(speakRequests.some((t) => t.includes('only look up past meetings for the account owner'))).toBe(true);
  });

  it('each bot acts for its own bot_runs user: the second user\'s meeting uses only that user\'s data', async () => {
    await post(event('bot-B', 'Bea Other', 'Meeting Mind what is the launch budget again'));
    await settle(1200);
    const sys = JSON.stringify(llmRequests[0].system);
    expect(sys).toContain('Bravo budget call');
    expect(sys).not.toContain('Alpha roadmap review');
    expect(plays('bot-B').length).toBe(2);
  });

  it('a payload cannot choose the user: extra user fields are ignored and an unknown bot is ignored', async () => {
    const e: any = event('bot-A', 'Gina Guest', 'Meeting Mind summarize everything we discussed so far please');
    e.data.user_id = B; e.data.data.participant.user_id = B; e.user_id = B;
    await post(e);
    await post(event('bot-UNKNOWN', 'Alex Owner', 'Meeting Mind what did we decide about the launch'));
    await settle(1200);
    expect(JSON.stringify(llmRequests)).not.toContain('Bravo budget call');
    expect(plays('bot-UNKNOWN')).toHaveLength(0);
  });

  it('kill switch: the next event is ignored and nothing is played', async () => {
    process.env.VOICE_ASSISTANT_KILL = '1';
    const r = await post(event('bot-B', 'Bea Other', 'Meeting Mind what is the launch budget again please'));
    await settle(200);
    expect(r.json).toMatchObject({ ok: true, handled: false });
    expect(recall).toHaveLength(0);
    expect(llmRequests).toHaveLength(0);
  });
});

describe('createBot wiring against Recall', () => {
  it('mode all: the Recall request carries the extra real-time endpoint and the intro; mode off: the request is the old one', async () => {
    const { RecallService } = await import('../../src/services/recallService.js');
    await RecallService.createBot({ meeting_url: 'https://meet.google.com/abc-defg-hij', user_id: A });
    const on = JSON.parse(recall.filter((r) => r.path === '/bot').pop()!.b64!);
    const eps = on.recording_config.realtime_endpoints;
    expect(eps).toHaveLength(2);
    expect(eps[0].url).toBe('https://backend.example.test/v1/webhooks/recall/transcript');
    expect(eps[1].url).toMatch(/^https:\/\/backend\.example\.test\/v1\/webhooks\/recall-assistant\?vt=[0-9a-f]{40}$/);
    expect(on.automatic_audio_output.in_call_recording.data.kind).toBe('mp3');
    expect(on.automatic_audio_output.in_call_recording.data.b64_data.length).toBeGreaterThan(100);

    process.env.VOICE_ASSISTANT_MODE = 'off';
    await RecallService.createBot({ meeting_url: 'https://meet.google.com/abc-defg-hij', user_id: A });
    const off = JSON.parse(recall.filter((r) => r.path === '/bot').pop()!.b64!);
    expect(off.recording_config.realtime_endpoints).toHaveLength(1);
    expect(off).not.toHaveProperty('automatic_audio_output');
    process.env.VOICE_ASSISTANT_MODE = 'all';
  });
});

describe('owner roll-up endpoint', () => {
  it('requires the internal secret (fails closed) and returns the metrics the owner asked for', async () => {
    expect((await realFetch(`${base}/internal/voice-assistant/rollup`)).status).toBe(401);
    expect((await realFetch(`${base}/internal/voice-assistant/rollup`, { headers: { 'x-internal-secret': 'wrong' } })).status).toBe(401);
    const res = await realFetch(`${base}/internal/voice-assistant/rollup?days=3`, { headers: { 'x-internal-secret': process.env.INTERNAL_SECRET! } });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toMatchObject({ mode: 'all', killed: false, caps: { perMeeting: 15, perUserPerDay: 40 } });
    const today = body.days[0];
    expect(today.questions).toBeGreaterThan(0);
    expect(today.answered).toBeGreaterThan(0);
    expect(today).toHaveProperty('ttfaMs.p95');
    expect(today).toHaveProperty('costUsd.perAnswer');
    expect(JSON.stringify(body)).not.toMatch(/launch|roadmap|Alex|Gina/); // counts only, never content
  });
});
