import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { mintIngestToken } from '../src/auth.js';
import { IngestServer } from '../src/server.js';
import { FakeEngine } from './helpers/fakeEngine.js';
import { MemorySink } from './helpers/memorySink.js';

const SECRET = 'test-secret';
const REF = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const REF2 = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const pcm = Buffer.alloc(6400, 2);
const audio = (relative: number, bot = 'bot-1') => JSON.stringify({ event: 'audio_mixed_raw.data', data: { data: { buffer: pcm.toString('base64'), timestamp: { relative, absolute: 'x' } }, bot: { id: bot } } });

let server: IngestServer;
let port: number;
let engine: FakeEngine;
let alerts: string[];

const url = (ref: string, token = mintIngestToken(SECRET, ref)) => `ws://127.0.0.1:${port}/ingest/${ref}/?token=${token}`;
const open = (u: string) => new Promise<WebSocket>((resolve, reject) => {
  const ws = new WebSocket(u);
  ws.on('open', () => resolve(ws));
  ws.on('error', reject);
  ws.on('unexpected-response', (_q, res) => reject(Object.assign(new Error('status'), { status: res.statusCode })));
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  engine = new FakeEngine();
  alerts = [];
  server = new IngestServer({
    ingestSecrets: [SECRET], engine, sink: new MemorySink(), maxStreams: 2, maxSessions: 2, adminToken: 'adm',
    alert: (k) => alerts.push(k), recallGraceMs: 200, maxAuthFailuresPerMin: 3, session: { idleFlushMs: 50, closeGraceMs: 50 },
  });
  port = await server.listen(0, '127.0.0.1');
});
afterEach(async () => { await server.stop(); });

describe('ingest server', () => {
  it('serves /healthz', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, sessions: 0, streams: { inUse: 0, cap: 2 } });
  });

  it('protects per-meeting detail with the admin token and does not expose raw refs', async () => {
    expect((await fetch(`http://127.0.0.1:${port}/healthz?detail=1`)).status).toBe(401);
    const ws = await open(url(REF));
    ws.send(audio(0));
    await wait(50);
    const r = await fetch(`http://127.0.0.1:${port}/healthz?detail=1`, { headers: { authorization: 'Bearer adm' } });
    const body = await r.json() as { meetings: { id: string; audioSecondsIn: number }[] };
    expect(body.meetings).toHaveLength(1);
    expect(body.meetings[0]!.audioSecondsIn).toBeCloseTo(0.2, 3);
    expect(JSON.stringify(body)).not.toContain(REF);
    ws.close();
  });

  it('rejects a wrong token, an unknown path and a missing token, and never starts a session', async () => {
    await expect(open(url(REF, 'f'.repeat(64)))).rejects.toMatchObject({ status: 401 });
    await expect(open(`ws://127.0.0.1:${port}/nope`)).rejects.toMatchObject({ status: 404 });
    await expect(open(`ws://127.0.0.1:${port}/ingest/${REF}/`)).rejects.toMatchObject({ status: 401 });
    expect(server.sessions.size).toBe(0);
  });

  it('blocks an IP after repeated auth failures (429), even for a valid token', async () => {
    for (let i = 0; i < 3; i++) await expect(open(url(REF, '0'.repeat(64)))).rejects.toMatchObject({ status: 401 });
    await expect(open(url(REF))).rejects.toMatchObject({ status: 429 });
  });

  it('feeds Recall audio into the engine, pins the bot id and ignores a different bot id', async () => {
    const ws = await open(url(REF));
    ws.send(audio(0, 'bot-1'));
    ws.send(audio(0.2, 'bot-1'));
    ws.send(audio(0.4, 'someone-else'));
    ws.send(Buffer.from([1, 2, 3])); // binary frames are not the documented format
    await wait(80);
    expect(engine.conns).toHaveLength(1);
    expect(engine.last.bytes).toBe(2 * 6400);
    const m = server.sessions.get(REF)!.session.metrics.snapshot();
    expect(m.invalidMessages).toBe(2);
    expect(server.sessions.get(REF)!.session.botId).toBe('bot-1');
    ws.close();
  });

  it('a Recall reconnect within the grace period continues the same session and replaces the old socket', async () => {
    const a = await open(url(REF));
    a.send(audio(0));
    await wait(30);
    const closed = new Promise((r) => a.on('close', r));
    const b = await open(url(REF));
    await closed;
    b.send(audio(0.2));
    await wait(30);
    expect(server.sessions.size).toBe(1);
    expect(engine.conns).toHaveLength(1);
    expect(engine.last.bytes).toBe(2 * 6400);
    b.close();
  });

  it('closes the session after the grace period when Recall never comes back', async () => {
    const ws = await open(url(REF));
    ws.send(audio(0));
    await wait(30);
    ws.close();
    await wait(100);
    expect(server.sessions.size).toBe(1);
    await wait(400);
    expect(server.sessions.size).toBe(0);
    expect(server.limiter.inUse()).toBe(0);
  });

  it('refuses new meetings beyond maxSessions with 503 and raises an alert', async () => {
    const a = await open(url(REF));
    const b = await open(url(REF2));
    await expect(open(url('cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee'))).rejects.toMatchObject({ status: 503 });
    expect(alerts).toContain('mm_stream_cap');
    a.close(); b.close();
  });

  it('enforces the global Soniox stream cap across meetings (shared-key protection)', async () => {
    const cap = new FakeEngine();
    const s2 = new IngestServer({ ingestSecrets: [SECRET], engine: cap, sink: new MemorySink(), maxStreams: 1, maxSessions: 5, alert: (k) => alerts.push(k), session: { capBackoffMs: 60_000, closeGraceMs: 50 } });
    const p2 = await s2.listen(0, '127.0.0.1');
    const u = (ref: string) => `ws://127.0.0.1:${p2}/ingest/${ref}/?token=${mintIngestToken(SECRET, ref)}`;
    const a = await open(u(REF));
    const b = await open(u(REF2));
    a.send(audio(0)); b.send(audio(0, 'bot-2'));
    await wait(80);
    expect(cap.conns).toHaveLength(1); // second meeting has to wait for a slot
    expect(alerts).toContain('mm_stream_cap');
    a.close(); b.close();
    await s2.stop();
  });
});
