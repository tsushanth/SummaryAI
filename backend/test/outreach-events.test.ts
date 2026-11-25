import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  outreachAttribution, outreachConfig, sendOutreachEvent, reportOutreachEvent, reportActivationForUser, resetOutreachActivationCache,
} from '../src/services/outreachEvents.js';

const ENV = { OUTREACH_EVENTS_URL: 'https://calldesk.example/api/outreach/event', OUTREACH_EVENT_SECRET: 's'.repeat(32) } as NodeJS.ProcessEnv;
const ATTR = { campaign: 'mm-2026-12-a', linkCode: 'abc123' };
const flush = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => resetOutreachActivationCache());

describe('outreachAttribution', () => {
  it('needs utm_source=outreach and a slug campaign', () => {
    expect(outreachAttribution({ utm_source: 'outreach', utm_campaign: 'MM-2026-12-A', utm_content: 'abc123' })).toEqual({ campaign: 'mm-2026-12-a', linkCode: 'abc123' });
    expect(outreachAttribution({ utm_source: 'outreach', utm_campaign: 'x' })).toEqual({ campaign: 'x', linkCode: null });
    expect(outreachAttribution({ utm_source: 'google', utm_campaign: 'x' })).toBeNull();
    expect(outreachAttribution({ utm_source: 'outreach' })).toBeNull();
    expect(outreachAttribution({ utm_source: 'outreach', utm_campaign: 'bad campaign!' })).toBeNull();
    expect(outreachAttribution(null)).toBeNull();
  });
  it('drops a link code that is not an opaque token', () => {
    expect(outreachAttribution({ utm_source: 'outreach', utm_campaign: 'c', utm_content: 'a@b.com' })?.linkCode).toBeNull();
  });
});

describe('outreachConfig (off by default)', () => {
  it('is null when the URL is unset, empty, not https, or the secret is missing', () => {
    expect(outreachConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(outreachConfig({ ...ENV, OUTREACH_EVENTS_URL: '  ' })).toBeNull();
    expect(outreachConfig({ ...ENV, OUTREACH_EVENTS_URL: 'http://x.test/e' })).toBeNull();
    expect(outreachConfig({ OUTREACH_EVENTS_URL: ENV.OUTREACH_EVENTS_URL } as NodeJS.ProcessEnv)).toBeNull();
  });
  it('prefers the per-product secret over the shared one', () => {
    expect(outreachConfig({ ...ENV, OUTREACH_EVENT_SECRET_MEETINGMIND: 'p'.repeat(32) })?.secret).toBe('p'.repeat(32));
    expect(outreachConfig(ENV)?.secret).toBe('s'.repeat(32));
  });
});

describe('sendOutreachEvent', () => {
  it('posts a signed signup body to the configured URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const logs: string[] = [];
    const out = await sendOutreachEvent({ event: 'signup', attribution: ATTR, email: 'new.user@example.com' }, { env: ENV, fetchImpl: fetchImpl as any, log: (l) => logs.push(l) });
    expect(out).toBe('sent');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(ENV.OUTREACH_EVENTS_URL);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ product: 'meetingmind', campaign: 'mm-2026-12-a', event: 'signup', email: 'new.user@example.com', link_code: 'abc123' });
    expect(init.headers['x-outreach-product']).toBe('meetingmind');
    const expected = 'v1=' + createHmac('sha256', 's'.repeat(32)).update(`${init.headers['x-outreach-timestamp']}.${init.body}`).digest('hex');
    expect(init.headers['x-outreach-signature']).toBe(expected);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(logs).toEqual(['[outreach] signup campaign=mm-2026-12-a status=200']);
    expect(logs.join()).not.toMatch(/example\.com|abc123/);
  });
  it('does nothing when off', async () => {
    const fetchImpl = vi.fn();
    expect(await sendOutreachEvent({ event: 'signup', attribution: ATTR, email: 'a@b.com' }, { env: {} as NodeJS.ProcessEnv, fetchImpl: fetchImpl as any })).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('retries once on a 5xx or a network error, then gives up without throwing', async () => {
    const fetchImpl = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); });
    const logs: string[] = [];
    expect(await sendOutreachEvent({ event: 'activated', attribution: ATTR, email: 'a@b.com' }, { env: ENV, fetchImpl: fetchImpl as any, retryDelayMs: 1, log: (l) => logs.push(l) })).toBe('failed');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(logs).toEqual(['[outreach] activated campaign=mm-2026-12-a error=TimeoutError']);
    const f2 = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('{}', { status: 200 }));
    expect(await sendOutreachEvent({ event: 'signup', attribution: ATTR, email: 'a@b.com' }, { env: ENV, fetchImpl: f2 as any, retryDelayMs: 1, log: () => {} })).toBe('sent');
  });
  it('does not retry a 4xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    expect(await sendOutreachEvent({ event: 'signup', attribution: ATTR, email: 'a@b.com' }, { env: ENV, fetchImpl: fetchImpl as any, retryDelayMs: 1, log: () => {} })).toBe('failed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('reportOutreachEvent returns synchronously and never throws, even when fetch hangs or fails', () => {
    const hang = vi.fn(() => new Promise(() => {}));
    expect(reportOutreachEvent({ event: 'signup', attribution: ATTR, email: 'a@b.com' }, { env: ENV, fetchImpl: hang as any })).toBeUndefined();
    expect(() => reportOutreachEvent({ event: 'signup', attribution: ATTR, email: 'a@b.com' }, { env: ENV, fetchImpl: (() => { throw new Error('sync'); }) as any, retryDelayMs: 1, log: () => {} })).not.toThrow();
  });
});

describe('reportActivationForUser', () => {
  const lookups = (attr: any, email: string | null = 'u@example.com') => ({ getAttribution: vi.fn(async () => attr), getEmail: vi.fn(async () => email) });

  it('does no lookup at all while off', async () => {
    const l = lookups(ATTR);
    reportActivationForUser('u1', l, { env: {} as NodeJS.ProcessEnv });
    await flush();
    expect(l.getAttribution).not.toHaveBeenCalled();
  });
  it('reports activated for an outreach user, once per process', async () => {
    const l = lookups(ATTR);
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const deps = { env: ENV, fetchImpl: fetchImpl as any, log: () => {} };
    reportActivationForUser('u1', l, deps);
    reportActivationForUser('u1', l, deps);
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(l.getAttribution).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as any)[1].body);
    expect(body).toMatchObject({ event: 'activated', campaign: 'mm-2026-12-a', meta: { milestone: 'first_recording_completed' } });
  });
  it('ignores users without outreach attribution and swallows lookup errors', async () => {
    const fetchImpl = vi.fn();
    reportActivationForUser('u2', lookups(null), { env: ENV, fetchImpl: fetchImpl as any });
    reportActivationForUser('u3', { getAttribution: async () => { throw new Error('db down'); }, getEmail: async () => null }, { env: ENV, fetchImpl: fetchImpl as any });
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
