import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import twilio from 'twilio';

process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const { twilioWebhookAuth, verifyTwilioRequest, candidateUrls, resetTwilioAuthCounters } = await import('../src/lib/twilioWebhookAuth.js');

const TOKEN = 'test-auth-token-0123456789abcdef';
const SERVICE_URL = 'https://summary-ai-backend.fly.dev';

function sign(url: string, params: Record<string, string>, token = TOKEN): string {
  return twilio.getExpectedTwilioSignature(token, url, params);
}

let server: Server | undefined;
async function start(enforce: boolean, mount = '/v1/webhooks/twilio') {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  const hits: string[] = [];
  app.use(mount, twilioWebhookAuth({ enforce, authToken: () => TOKEN, serviceUrl: () => SERVICE_URL }));
  app.post(`${mount}/call-status`, (req, res) => {
    hits.push('call-status');
    res.json({ ok: true });
  });
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', r)));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return { base, hits };
}
const form = (p: Record<string, string>) => new URLSearchParams(p).toString();

beforeEach(() => {
  resetTwilioAuthCounters();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise((r) => (server ? server.close(() => r(null)) : r(null)));
  server = undefined;
});

describe('verifyTwilioRequest', () => {
  const params = { CallSid: 'CA123', CallStatus: 'completed' };
  const req = (sig: string | undefined, url = '/v1/webhooks/twilio/call-status?call_id=abc') =>
    ({ originalUrl: url, headers: { host: 'summary-ai-backend.fly.dev', ...(sig ? { 'x-twilio-signature': sig } : {}) }, body: params }) as any;

  it('accepts a correctly signed request (URL built from SERVICE_URL)', () => {
    const url = `${SERVICE_URL}/v1/webhooks/twilio/call-status?call_id=abc`;
    expect(verifyTwilioRequest(req(sign(url, params)), TOKEN, SERVICE_URL)).toEqual({ ok: true });
  });
  it('accepts when Twilio called the same path without the /v1 prefix (TwiML App configured at root)', () => {
    const url = `${SERVICE_URL}/webhooks/twilio/call-status?call_id=abc`;
    expect(verifyTwilioRequest(req(sign(url, params)), TOKEN, SERVICE_URL).ok).toBe(true);
  });
  it('rejects missing signature, wrong token, tampered params, and missing auth token', () => {
    const url = `${SERVICE_URL}/v1/webhooks/twilio/call-status?call_id=abc`;
    expect(verifyTwilioRequest(req(undefined), TOKEN, SERVICE_URL)).toEqual({ ok: false, reason: 'no_signature_header' });
    expect(verifyTwilioRequest(req(sign(url, params, 'other-token-0123456789abcdef')), TOKEN, SERVICE_URL)).toEqual({ ok: false, reason: 'signature_mismatch' });
    expect(verifyTwilioRequest(req(sign(url, { ...params, CallStatus: 'failed' })), TOKEN, SERVICE_URL).ok).toBe(false);
    expect(verifyTwilioRequest(req(sign(url, params)), undefined, SERVICE_URL)).toEqual({ ok: false, reason: 'auth_token_not_configured' });
  });
  it('builds candidate URLs from SERVICE_URL and the Host header', () => {
    const c = candidateUrls({ originalUrl: '/v1/webhooks/twilio/x?a=1', headers: { host: 'h.example' } } as any, 'https://svc.example/');
    expect(c).toContain('https://svc.example/v1/webhooks/twilio/x?a=1');
    expect(c).toContain('https://h.example/v1/webhooks/twilio/x?a=1');
    expect(c).toContain('https://h.example/webhooks/twilio/x?a=1');
  });
});

describe('twilioWebhookAuth middleware over HTTP', () => {
  const params = { CallSid: 'CA123', CallStatus: 'completed' };
  const post = (base: string, path: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: form(params) });

  it('phase 1: an unsigned request still reaches the handler, and the log has header names only', async () => {
    const { base, hits } = await start(false);
    const res = await post(base, '/v1/webhooks/twilio/call-status?call_id=abc', { 'x-secret-looking': 'LEAK-ME' });
    expect(res.status).toBe(200);
    expect(hits).toEqual(['call-status']);
    const lines = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    const line = lines.find((l) => l.includes('"event":"webhook_auth"'))!;
    expect(JSON.parse(line)).toMatchObject({ provider: 'twilio', outcome: 'failed', reason: 'no_signature_header', enforced: false, count: 1, route: '/v1/webhooks/twilio/call-status' });
    expect(line).not.toContain('LEAK-ME');
    expect(line).not.toContain('call_id');
  });
  it('phase 1: a bad signature is accepted but logged as signature_mismatch', async () => {
    const { base, hits } = await start(false);
    const res = await post(base, '/v1/webhooks/twilio/call-status?call_id=abc', { 'X-Twilio-Signature': 'bogus' });
    expect(res.status).toBe(200);
    expect(hits.length).toBe(1);
    expect(vi.mocked(console.warn).mock.calls.some((c) => String(c[0]).includes('signature_mismatch'))).toBe(true);
  });
  it('a correctly signed request is logged ok (the proof that phase 1 saw real signed traffic)', async () => {
    const { base, hits } = await start(false);
    const path = '/v1/webhooks/twilio/call-status?call_id=abc';
    const res = await post(base, path, { 'X-Twilio-Signature': sign(`${SERVICE_URL}${path}`, params) });
    expect(res.status).toBe(200);
    expect(hits.length).toBe(1);
    expect(vi.mocked(console.log).mock.calls.some((c) => String(c[0]).includes('"outcome":"ok"'))).toBe(true);
  });
  it('enforce mode: unsigned and forged are 403 and never reach the handler; signed passes', async () => {
    const { base, hits } = await start(true);
    const path = '/v1/webhooks/twilio/call-status?call_id=abc';
    expect((await post(base, path)).status).toBe(403);
    expect((await post(base, path, { 'X-Twilio-Signature': 'bogus' })).status).toBe(403);
    expect(hits).toEqual([]);
    expect((await post(base, path, { 'X-Twilio-Signature': sign(`${SERVICE_URL}${path}`, params) })).status).toBe(200);
    expect(hits).toEqual(['call-status']);
  });
});

describe('wiring', () => {
  it('webhooks router mounts the Twilio signature middleware before the Twilio routes', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../src/routes/webhooks.ts', import.meta.url), 'utf8');
    const mw = src.indexOf("router.use('/twilio', twilioWebhookAuth(");
    const first = src.indexOf("router.post('/twilio/");
    expect(mw).toBeGreaterThan(-1);
    expect(mw).toBeLessThan(first);
  });
});
