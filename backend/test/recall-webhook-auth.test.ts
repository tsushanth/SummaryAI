import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Webhook } from 'svix';

process.env.NODE_ENV = 'development'; // config rejects 'test'; failureReporter stays disabled in development
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const KEY = randomBytes(32);
const SECRET = 'whsec_' + KEY.toString('base64');
process.env.RECALL_WEBHOOK_SECRET = SECRET;

const { verifyRecallWebhook, checkRecallWebhook, signatureHeaderNames } = await import('../src/lib/recallWebhookAuth.js');

const NOW = 1_800_000_000_000;
const ts = String(Math.floor(NOW / 1000));
const body = JSON.stringify({ event: 'bot.done', data: { bot_id: 'b1' } });
const sig = (id: string, t: string, raw: string, key = KEY) => 'v1,' + createHmac('sha256', key).update(`${id}.${t}.${raw}`).digest('base64');
const hdr = (prefix: 'webhook' | 'svix', over: Record<string, string> = {}) => ({ [`${prefix}-id`]: 'msg_1', [`${prefix}-timestamp`]: ts, [`${prefix}-signature`]: sig('msg_1', ts, body), ...over });
const verify = (over: Record<string, unknown> = {}) => verifyRecallWebhook({ rawBody: Buffer.from(body), headers: hdr('webhook'), secrets: [SECRET], nowMs: NOW, ...over } as any);

describe('verifyRecallWebhook', () => {
  it('accepts a correctly signed delivery with webhook-* and with legacy svix-* headers', () => {
    expect(verify()).toMatchObject({ ok: true, scheme: 'webhook' });
    expect(verify({ headers: hdr('svix') })).toMatchObject({ ok: true, scheme: 'svix' });
  });
  it('agrees with the official svix library (sign with svix, verify with ours)', () => {
    const t = new Date(NOW);
    const s = new Webhook(SECRET).sign('msg_9', t, body);
    expect(verify({ headers: { 'webhook-id': 'msg_9', 'webhook-timestamp': ts, 'webhook-signature': s } }).ok).toBe(true);
  });
  it('accepts when any entry of a multi-signature header matches, or when either configured secret matches', () => {
    const rotated = 'v1,' + 'A'.repeat(44) + ' v2,x ' + sig('msg_1', ts, body);
    expect(verify({ headers: hdr('webhook', { 'webhook-signature': rotated }) }).ok).toBe(true);
    expect(verify({ secrets: ['whsec_' + randomBytes(32).toString('base64'), SECRET] }).ok).toBe(true);
  });
  it('refuses forged, wrong-secret, tampered and re-serialised bodies', () => {
    expect(verify({ headers: hdr('webhook', { 'webhook-signature': 'v1,' + 'A'.repeat(44) }) })).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(verify({ secrets: ['whsec_' + randomBytes(32).toString('base64')] }).ok).toBe(false);
    expect(verify({ rawBody: Buffer.from(body.replace('b1', 'b2')) }).ok).toBe(false);
    expect(verify({ rawBody: Buffer.from(JSON.stringify(JSON.parse(body), null, 2)) }).ok).toBe(false);
  });
  it('refuses a replay outside +/-5 minutes', () => {
    for (const d of [-301, 301]) {
      const t = String(Math.floor(NOW / 1000) + d);
      expect(verify({ headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': t, 'webhook-signature': sig('msg_1', t, body) } })).toMatchObject({ ok: false, reason: 'stale_timestamp' });
    }
  });
  it('refuses missing secret / no headers / partial headers / missing raw body (old code allowed these)', () => {
    expect(verify({ secrets: [undefined, ''] })).toMatchObject({ reason: 'no_secret' });
    expect(verify({ headers: {} })).toMatchObject({ reason: 'no_signature_headers' });
    expect(verify({ headers: { 'webhook-id': 'x', 'webhook-timestamp': ts } })).toMatchObject({ reason: 'partial_headers' });
    expect(verify({ rawBody: undefined })).toMatchObject({ reason: 'no_raw_body' });
  });
  it('reports header names only', () => {
    expect(signatureHeaderNames({ ...hdr('svix'), authorization: 'Bearer x' }).sort()).toEqual(['svix-id', 'svix-signature', 'svix-timestamp']);
  });
});

describe('Recall routes over HTTP (phase 1: accept + log, but legacy rejections stay)', () => {
  let server: Server | undefined;
  const alerts: string[] = [];
  const botRun = { id: 'br1', meeting_id: 'm1', user_id: 'u1' };

  async function start() {
    vi.resetModules();
    process.env.RECALL_WEBHOOK_SECRET = SECRET;
    vi.doMock('../src/lib/alerts.js', async (orig) => ({ ...(await orig<any>()), reportAlert: (flow: string, code: string) => { alerts.push(`${flow}:${code}`); return true; } }));
    vi.doMock('../src/lib/supabase.js', () => {
      const chain: any = { select: () => chain, eq: () => chain, single: async () => ({ data: null, error: { message: 'none' } }), insert: async () => ({ error: null }) };
      return { supabaseAdmin: { from: () => chain } };
    });
    const { default: router } = await import('../src/routes/webhooks.js');
    const app = express();
    // same raw-body capture as src/index.ts
    app.use(express.json({ verify: (req, _res, buf) => { if ((req as any).originalUrl.includes('/webhooks/recall')) (req as any).rawBody = buf; } }));
    app.use('/v1/webhooks', router);
    await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', r)));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }
  const post = (base: string, path: string, raw: string, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw });
  const nowSig = (raw: string) => { const t = String(Math.floor(Date.now() / 1000)); return { 'webhook-id': 'msg_1', 'webhook-timestamp': t, 'webhook-signature': sig('msg_1', t, raw) }; };

  beforeEach(() => { alerts.length = 0; vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(async () => { vi.restoreAllMocks(); vi.doUnmock('../src/lib/alerts.js'); vi.doUnmock('../src/lib/supabase.js'); await new Promise((r) => (server ? server.close(() => r(null)) : r(null))); server = undefined; });

  it('transcript route: unsigned request is still accepted in phase 1 but logged as unverified and alerted', async () => {
    const base = await start();
    const raw = JSON.stringify({ event: 'ignored.event' });
    const res = await post(base, '/v1/webhooks/recall/transcript', raw);
    expect(res.status).toBe(200);
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"webhook_auth"'));
    expect(JSON.parse(lines[0]!)).toMatchObject({ provider: 'recall', route: '/webhooks/recall/transcript', outcome: 'unverified_accepted', reason: 'no_signature_headers', signatureHeaders: 'none' });
    expect(alerts).toContain('webhook_auth_recall:NO_SIGNATURE_HEADERS');
  });

  it('transcript route: a correctly signed delivery is logged ok (proof that phase 1 saw real signed traffic) and verified against RAW bytes', async () => {
    const base = await start();
    const raw = '{"event":"ignored.event",  "data":{}}'; // deliberately odd spacing: JSON.stringify(req.body) would not reproduce it
    const res = await post(base, '/v1/webhooks/recall/transcript', raw, nowSig(raw));
    expect(res.status).toBe(200);
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"webhook_auth"'));
    expect(JSON.parse(lines[0]!)).toMatchObject({ outcome: 'ok', scheme: 'webhook' });
    expect(alerts).toEqual([]);
  });

  it('/recall: unsigned still reaches the handler (404 bot-run-not-found from the mocked DB, not 401) and is logged unverified', async () => {
    const base = await start();
    const raw = JSON.stringify({ event: 'bot.done', data: { bot_id: 'b1' } });
    const res = await post(base, '/v1/webhooks/recall', raw);
    expect(res.status).toBe(404);
    expect(alerts).toContain('webhook_auth_recall:NO_SIGNATURE_HEADERS');
  });

  it('/recall: svix-* headers that fail BOTH the new and the legacy check are still rejected with 401 (no loosening)', async () => {
    const base = await start();
    const raw = JSON.stringify({ event: 'bot.done', data: { bot_id: 'b1' } });
    const t = String(Math.floor(Date.now() / 1000));
    const res = await post(base, '/v1/webhooks/recall', raw, { 'svix-id': 'msg_1', 'svix-timestamp': t, 'svix-signature': 'v1,' + 'A'.repeat(44) });
    expect(res.status).toBe(401);
  });

  it('/recall: a correctly signed delivery verifies even when JSON re-serialisation would differ', async () => {
    const base = await start();
    const raw = '{"event": "bot.done",  "data": {"bot_id": "b1"}}';
    const res = await post(base, '/v1/webhooks/recall', raw, nowSig(raw));
    expect(res.status).toBe(404); // reached the handler; bot run not found in the mock
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"webhook_auth"'));
    expect(JSON.parse(lines[0]!)).toMatchObject({ outcome: 'ok' });
  });
});
