import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

// ---- minimal in-memory supabase fake -------------------------------------
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};

function query(table: string) {
  let rows = () => db[table] ?? [];
  const filters: ((r: Row) => boolean)[] = [];
  let mode: 'select' | 'update' | 'insert' = 'select';
  let patch: Row = {};
  let inserted: Row[] = [];
  let lim = Infinity;
  const apply = () => rows().filter((r) => filters.every((f) => f(r))).slice(0, lim);
  const run = () => {
    if (mode === 'update') {
      const hit = apply();
      hit.forEach((r) => Object.assign(r, patch));
      return hit;
    }
    if (mode === 'insert') {
      (db[table] ??= []).push(...inserted);
      return inserted;
    }
    return apply();
  };
  const q: any = {
    select: () => q,
    eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
    in: (c: string, vs: any[]) => (filters.push((r) => vs.includes(r[c])), q),
    order: () => q,
    limit: (n: number) => ((lim = n), q),
    update: (p: Row) => ((mode = 'update'), (patch = p), q),
    insert: (p: Row | Row[]) => ((mode = 'insert'), (inserted = Array.isArray(p) ? p : [p]), q),
    maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
  };
  return q;
}

vi.mock('../src/config/index.js', () => ({ config: { NODE_ENV: 'test' } }));
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: (t: string) => query(t) } }));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: req.headers['x-user'] };
    next();
  },
}));

const llmCalls: { system: string; user: string }[] = [];
let llmReply = '{}';
vi.mock('../src/services/intelligenceService.js', async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    completeText: vi.fn(async (o: any) => {
      llmCalls.push({ system: o.system, user: o.user });
      return llmReply;
    }),
  };
});

const { default: router } = await import('../src/routes/intelligence.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

async function call(method: string, path: string, user: string, body?: any) {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  app.use(errorHandler as any);
  const server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-user': user },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  llmCalls.length = 0;
  llmReply = '{}';
  db.recordings = [
    { id: '11111111-1111-4111-8111-111111111111', user_id: 'alice', title: 'Alice budget sync', status: 'completed' },
    { id: '22222222-2222-4222-8222-222222222222', user_id: 'bob', title: 'Bob roadmap', status: 'completed' },
  ];
  db.transcripts = [
    { recording_id: '11111111-1111-4111-8111-111111111111', full_text: 'Alice said the secret budget number is 4242 dollars for Q3.', segments: [] },
    { recording_id: '22222222-2222-4222-8222-222222222222', full_text: 'Bob said the roadmap ships in March with the new budget process.', segments: [] },
  ];
  db.summaries = [
    {
      recording_id: '11111111-1111-4111-8111-111111111111',
      summary: 'Alice budget summary',
      key_points: [],
      action_items: [{ task: 'Send budget', assignee: 'Alice', priority: 'high', due_date: '2026-11-01' }, { task: 'Vague', due_date: 'next week' }],
    },
    { recording_id: '22222222-2222-4222-8222-222222222222', summary: 'Bob roadmap summary', key_points: [], action_items: [] },
  ];
  db.profiles = [{ id: 'alice', preferences: { audio_quality: 'standard' } }];
  db.todos = [];
});

describe('cross-meeting chat data scoping', () => {
  it('never sends or cites another user\'s recordings', async () => {
    llmReply = JSON.stringify({ answer: 'Ships in March.', sources: [1, 2, 3, 99] });
    const r = await call('POST', '/chat', 'bob', { question: 'what is the budget plan?' });
    expect(r.status).toBe(200);
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0].user).not.toContain('4242');
    expect(llmCalls[0].user).not.toContain('Alice');
    for (const c of r.json.citations) expect(c.recording_id).toBe('22222222-2222-4222-8222-222222222222');
    expect(r.json.citations.length).toBeGreaterThan(0);
  });

  it('ignores a foreign recording_ids filter', async () => {
    const r = await call('POST', '/chat', 'bob', {
      question: 'budget number',
      recording_ids: ['11111111-1111-4111-8111-111111111111'],
    });
    expect(r.status).toBe(200);
    expect(llmCalls).toHaveLength(0); // nothing in scope, LLM never called
    expect(r.json.citations).toEqual([]);
  });

  it('answers a different user from their own data only', async () => {
    llmReply = JSON.stringify({ answer: '4242 dollars.', sources: [1] });
    const r = await call('POST', '/chat', 'alice', { question: 'what is the budget number?' });
    expect(r.json.citations[0].recording_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(llmCalls[0].user).not.toContain('March');
  });
});

describe('other endpoints', () => {
  it('regenerate-summary 404s for another user\'s recording', async () => {
    const r = await call('POST', '/recordings/11111111-1111-4111-8111-111111111111/regenerate-summary', 'bob', { template: 'standup' });
    expect(r.status).toBe(404);
    expect(llmCalls).toHaveLength(0);
  });

  it('regenerate-summary stores the new summary and template', async () => {
    llmReply = JSON.stringify({ summary: 'New', key_points: ['k'], action_items: [{ task: 'x' }], topics: [] });
    const r = await call('POST', '/recordings/11111111-1111-4111-8111-111111111111/regenerate-summary', 'alice', { template: 'standup' });
    expect(r.status).toBe(200);
    expect(llmCalls[0].user).toContain('Standup');
    expect(db.summaries[0].summary).toBe('New');
    expect(db.recordings[0].summary_template).toBe('standup');
  });

  it('follow-up email returns subject and body', async () => {
    llmReply = JSON.stringify({ subject: 'Recap', body: 'Thanks all.' });
    const r = await call('POST', '/recordings/11111111-1111-4111-8111-111111111111/follow-up-email', 'alice', {});
    expect(r.json).toEqual({ subject: 'Recap', body: 'Thanks all.' });
    const denied = await call('POST', '/recordings/11111111-1111-4111-8111-111111111111/follow-up-email', 'bob', {});
    expect(denied.status).toBe(404);
  });

  it('action-items-to-todos persists assignee and valid due dates, and is idempotent', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const r = await call('POST', `/recordings/${id}/action-items-to-todos`, 'alice');
    expect(r.status).toBe(201);
    expect(db.todos).toHaveLength(2);
    const send = db.todos.find((t) => t.title === 'Send budget')!;
    expect(send.assignee).toBe('Alice');
    expect(send.due_date).toMatch(/^2026-11-01/);
    expect(db.todos.find((t) => t.title === 'Vague')!.due_date).toBeNull();
    const again = await call('POST', `/recordings/${id}/action-items-to-todos`, 'alice');
    expect(again.json.todos).toEqual([]);
    expect(db.todos).toHaveLength(2);
  });

  it('default template round-trips through profile preferences', async () => {
    const put = await call('PUT', '/summary-templates/default', 'alice', { template: 'sales_call' });
    expect(put.json.default_template).toBe('sales_call');
    const get = await call('GET', '/summary-templates', 'alice');
    expect(get.json.default_template).toBe('sales_call');
    expect(get.json.templates.length).toBeGreaterThan(5);
    expect(db.profiles[0].preferences.audio_quality).toBe('standard');
    const bad = await call('PUT', '/summary-templates/default', 'alice', { template: 'nope' });
    expect(bad.status).toBe(400);
  });
});
