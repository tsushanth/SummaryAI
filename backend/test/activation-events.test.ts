import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));
vi.mock('../src/config/index.js', () => ({ config: {} }));

const { createActivationRouter } = await import('../src/routes/activation.js');
const { ACTIVATION_EVENT_NAMES, sanitizeProps, validateEvent, validateAttribution, createLimiter } = await import('../src/services/activationEvents.js');
const { USER_TABLES } = await import('../src/services/accountPurgeAdapters.js').catch(() => ({ USER_TABLES: [] as any[] }));

const ANON = 'a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';
const UID = '11111111-1111-4111-8111-111111111111';

let enabled = true;
let events: any[] = [];
let attributions: any[] = [];
let user: string | null = null;
let failInsert = false;
let limiter = createLimiter();

function build() {
  const app = express();
  app.use(express.json());
  app.use('/api/activation', createActivationRouter({
    enabled: () => enabled,
    insertEvent: async (r) => { if (failInsert) throw new Error('boom'); events.push(r); },
    insertAttribution: async (r) => { attributions.push(r); },
    resolveUser: async () => user,
    limiter,
  }, (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
    req.user = { id: UID }; next();
  }));
  return app;
}

async function post(p: string, body: unknown, headers: Record<string, string> = {}) {
  const server = build().listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/activation${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: res.status };
  } finally { server.close(); }
}

beforeEach(() => { enabled = true; events = []; attributions = []; user = null; failInsert = false; limiter = createLimiter(); });

describe('allow-list and validation', () => {
  it('has exactly the nine contract names', () => {
    expect([...ACTIVATION_EVENT_NAMES].sort()).toEqual(['first_recording_done', 'first_recording_started', 'landed', 'record_clicked', 'sample_viewed', 'signup_done', 'signup_started', 'summary_viewed', 'upload_chosen']);
  });
  it('accepts every allowed name with 204 and stores one row each', async () => {
    for (const name of ACTIVATION_EVENT_NAMES) expect((await post('/events', { anon_id: ANON, name })).status).toBe(204);
    expect(events).toHaveLength(ACTIVATION_EVENT_NAMES.length);
    expect(events[0]).toMatchObject({ anon_id: ANON, user_id: null, platform: 'web', app_version: null });
  });
  it('unknown names, bad anon ids and non-object bodies are 400 and write nothing', async () => {
    expect((await post('/events', { anon_id: ANON, name: 'purchase' })).status).toBe(400);
    expect((await post('/events', { anon_id: 'short', name: 'landed' })).status).toBe(400);
    expect((await post('/events', { anon_id: 'has spaces and !! chars here', name: 'landed' })).status).toBe(400);
    expect((await post('/events', [1, 2])).status).toBe(400);
    expect(events).toHaveLength(0);
  });
  it('an insert failure never fails the client', async () => {
    failInsert = true;
    expect((await post('/events', { anon_id: ANON, name: 'landed' })).status).toBe(204);
  });
  it('attaches user_id only when a user was resolved from the Bearer token', async () => {
    user = UID;
    await post('/events', { anon_id: ANON, name: 'signup_done' }, { authorization: 'Bearer x' });
    expect(events[0].user_id).toBe(UID);
  });
});

describe('flag off', () => {
  it('both endpoints answer 204 and write nothing, even for junk', async () => {
    enabled = false;
    expect((await post('/events', { anon_id: ANON, name: 'landed' })).status).toBe(204);
    expect((await post('/events', { nonsense: true })).status).toBe(204);
    expect((await post('/attribution', { utm_source: 'x' }, { authorization: 'Bearer x' })).status).toBe(204);
    expect(events).toHaveLength(0);
    expect(attributions).toHaveLength(0);
  });
  it('defaults to off when the env var is unset', () => {
    delete process.env.ACTIVATION_EVENTS_ENABLED;
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/activation.ts'), 'utf8');
    expect(src).toContain("process.env.ACTIVATION_EVENTS_ENABLED === 'true'");
  });
});

describe('rate limits', () => {
  it('per anonymous id: the 301st event in an hour is 429', async () => {
    for (let i = 0; i < 300; i++) limiter.take(`anon:${ANON}`, 1, 300, 3_600_000);
    expect((await post('/events', { anon_id: ANON, name: 'landed' })).status).toBe(429);
    expect((await post('/events', { anon_id: 'ffffffff-0000-4000-8000-000000000000', name: 'landed' })).status).toBe(204);
  });
  it('per IP: the 61st request in a minute is 429 (distinct anon ids, so only the IP limit can trip)', async () => {
    const server = build().listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const statuses: number[] = [];
      for (let i = 0; i < 61; i++) {
        const anon = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
        const r = await fetch(`http://127.0.0.1:${port}/api/activation/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anon_id: anon, name: 'landed' }) });
        statuses.push(r.status);
      }
      expect(statuses.slice(0, 60).every((x) => x === 204)).toBe(true);
      expect(statuses[60]).toBe(429);
    } finally { server.close(); }
  });
  it('limiter window slides', () => {
    let t = 0;
    const l = createLimiter({ now: () => t });
    expect(l.take('k', 2, 2, 1000)).toBe(true);
    expect(l.take('k', 1, 2, 1000)).toBe(false);
    t = 1001;
    expect(l.take('k', 1, 2, 1000)).toBe(true);
  });
});

describe('props sanitising', () => {
  it('keeps numbers, booleans and short enums; drops free text, objects, bad keys; max 8 keys', () => {
    const out = sanitizeProps({
      utm_source: 'newsletter', n: 3, ok: true, text: 'hello this is free text', url: 'https://x.y/z?e=a@b.c',
      nested: { a: 1 }, arr: [1], 'Bad Key': 'x', inf: Infinity, long: 'a'.repeat(41), email: 'a@b.co',
    });
    expect(out).toEqual({ utm_source: 'newsletter', n: 3, ok: true });
    const many = sanitizeProps(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i])));
    expect(Object.keys(many)).toHaveLength(8);
    expect(sanitizeProps('nope')).toEqual({});
    expect(sanitizeProps([1])).toEqual({});
  });
  it('platform and version are constrained', () => {
    expect(validateEvent({ anon_id: ANON, name: 'landed', platform: 'toaster', app_version: 'ver sion!' }, null)).toMatchObject({ platform: 'web', app_version: null });
    expect(validateEvent({ anon_id: ANON, name: 'landed', platform: 'android', app_version: '1.7.5' }, null)).toMatchObject({ platform: 'android', app_version: '1.7.5' });
  });
});

describe('attribution', () => {
  it('requires auth when enabled', async () => {
    expect((await post('/attribution', { utm_source: 'x' })).status).toBe(401);
  });
  it('sanitises to short [a-z0-9._-] strings and stores for the authenticated user', async () => {
    await post('/attribution', { anon_id: ANON, utm_source: ' Reddit ', utm_medium: 'cpc;drop table', utm_campaign: 'x'.repeat(100), referrer_host: 'News.Example.com', landing_path: '/?utm=1' }, { authorization: 'Bearer x' });
    expect(attributions).toHaveLength(1);
    expect(attributions[0]).toMatchObject({ user_id: UID, anon_id: ANON, utm_source: 'reddit', utm_medium: null, referrer_host: 'news.example.com', landing_path: null, platform: 'web' });
    expect(attributions[0].utm_campaign).toHaveLength(64);
  });
  it('an empty or unusable body stores nothing', () => {
    expect(validateAttribution({}, UID)).toBeNull();
    expect(validateAttribution({ utm_source: '!!!' }, UID)).toBeNull();
  });
});

describe('account purge covers the new tables', () => {
  it('USER_TABLES deletes activation_events and signup_attribution by user_id, before profiles', () => {
    const names = USER_TABLES.map((t: any) => t.table);
    expect(names).toContain('activation_events');
    expect(names).toContain('signup_attribution');
    expect(USER_TABLES.find((t: any) => t.table === 'activation_events')).toEqual({ table: 'activation_events', col: 'user_id' });
    expect(names.indexOf('activation_events')).toBeLessThan(names.indexOf('profiles'));
  });
});

describe('migration file', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/027_activation_events.sql'), 'utf8');
  it('enables RLS on both tables with no policies and names every allowed event', () => {
    expect(sql).toMatch(/alter table activation_events enable row level security/);
    expect(sql).toMatch(/alter table signup_attribution enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
    for (const n of ACTIVATION_EVENT_NAMES) expect(sql).toContain(`'${n}'`);
  });
  it('has a rollback', () => {
    expect(fs.existsSync(path.join(__dirname, '../supabase/rollbacks/027_activation_events_down.sql'))).toBe(true);
  });
});
