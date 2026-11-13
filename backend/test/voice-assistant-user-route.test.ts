import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const USER = '11111111-1111-4111-8111-111111111111';
let authUser: { id: string } | undefined;
const db = { preferences: undefined as Record<string, unknown> | null | undefined, updateError: null as unknown, updates: [] as unknown[] };

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const q: any = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.maybeSingle = vi.fn(async () => ({ data: db.preferences === undefined ? null : { preferences: db.preferences }, error: null }));
      q.update = vi.fn((v: unknown) => { db.updates.push(v); return { eq: vi.fn(async () => ({ error: db.updateError })) }; });
      return q;
    }),
  },
}));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!authUser) { res.status(401).json({ error: { code: 'UNAUTHORIZED' } }); return; }
    req.user = authUser; next();
  },
}));
vi.mock('../src/services/recallService.js', () => ({ RecallService: {} }));
vi.mock('../src/config/index.js', () => ({ config: { ANTHROPIC_API_KEY: 'test', SUMMARY_MODEL: 'claude-haiku-4-5-20251001' } }));
vi.mock('../src/lib/llm.js', () => ({ instrumentAnthropic: (c: any) => c, withFeature: (_n: string, fn: any) => fn() }));

const { voiceAssistantUserRouter } = await import('../src/routes/voiceAssistant.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

let server: Server;
let url: string;
const envBackup = process.env.VOICE_ASSISTANT_MODE;

beforeEach(() => {
  authUser = { id: USER };
  db.preferences = undefined; db.updateError = null; db.updates = [];
  process.env.VOICE_ASSISTANT_MODE = 'all';
  delete process.env.VOICE_ASSISTANT_KILL;
  const app = express();
  app.use(express.json());
  app.use('/api/voice-assistant', voiceAssistantUserRouter);
  app.use(errorHandler);
  server = app.listen(0);
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/voice-assistant`;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  server.close();
  if (envBackup === undefined) delete process.env.VOICE_ASSISTANT_MODE; else process.env.VOICE_ASSISTANT_MODE = envBackup;
});

const put = (body: unknown) => fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('/api/voice-assistant (the client switch)', () => {
  it('GET: never set, mode all -> enabled, preference null', async () => {
    const r = await fetch(url);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enabled: true, reason: 'enabled', preference: null, mode: 'all' });
  });

  it('GET: opted out -> enabled false, reason user_opted_out, preference false', async () => {
    db.preferences = { voice_assistant: false };
    expect(await (await fetch(url)).json()).toEqual({ enabled: false, reason: 'user_opted_out', preference: false, mode: 'all' });
  });

  it('GET: kill switch -> enabled false, reason killed', async () => {
    process.env.VOICE_ASSISTANT_KILL = '1';
    expect(await (await fetch(url)).json()).toMatchObject({ enabled: false, reason: 'killed' });
  });

  it('PUT false: saves, keeps other preferences, returns the effective state', async () => {
    db.preferences = { theme: 'dark', voice_assistant: true };
    const r = await put({ enabled: false });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enabled: false, reason: 'user_opted_out', preference: false, mode: 'all' });
    expect(db.updates).toEqual([{ preferences: { theme: 'dark', voice_assistant: false } }]);
  });

  it('PUT true: switches back on', async () => {
    db.preferences = { voice_assistant: false };
    const r = await put({ enabled: true });
    expect(await r.json()).toEqual({ enabled: true, reason: 'enabled', preference: true, mode: 'all' });
  });

  it('PUT with a non-boolean body is a 400 and writes nothing', async () => {
    for (const body of [{}, { enabled: 'no' }, { enabled: 0 }]) {
      expect((await put(body)).status).toBe(400);
    }
    expect(db.updates).toHaveLength(0);
  });

  it('PUT when the database write fails is a 500', async () => {
    db.updateError = { message: 'boom' };
    expect((await put({ enabled: false })).status).toBe(500);
  });

  it('unauthenticated -> 401 for both verbs', async () => {
    authUser = undefined;
    expect((await fetch(url)).status).toBe(401);
    expect((await put({ enabled: false })).status).toBe(401);
  });
});
