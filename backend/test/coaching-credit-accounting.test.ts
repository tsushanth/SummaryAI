import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A tiny in-memory Supabase whose calls resolve a tick later, so simultaneous requests really interleave. */
const db: Record<string, any[]> = {};
let nextId = 0;
function table(name: string) {
  const filters: Array<(r: any) => boolean> = [];
  let op: 'select' | 'insert' | 'update' = 'select';
  let payload: any;
  const q: any = {};
  q.select = () => q; q.order = () => q; q.limit = () => q; q.or = () => q;
  q.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; };
  q.gt = (c: string, v: number) => { filters.push((r) => r[c] > v); return q; };
  q.lt = () => q;
  q.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; };
  q.insert = (p: any) => { op = 'insert'; payload = p; return q; };
  q.update = (p: any) => { op = 'update'; payload = p; return q; };
  const run = async () => {
    await new Promise((r) => setImmediate(r));
    const rows = (db[name] ??= []);
    if (op === 'insert') {
      const row = { id: `${name}-${++nextId}`, ended_at: null, insight_count: 0, ...payload };
      rows.push(row);
      return { data: { ...row }, error: null };
    }
    const hits = rows.filter((r) => filters.every((f) => f(r)));
    if (op === 'update') hits.forEach((r) => Object.assign(r, payload));
    return { data: hits[0] ? { ...hits[0] } : null, error: null };
  };
  q.single = run; q.maybeSingle = run;
  q.then = (a: any, b: any) => run().then(a, b);
  return q;
}
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: (t: string) => table(t) } }));
vi.mock('../src/config/index.js', () => ({ config: {} }));
vi.mock('../src/lib/llm.js', () => ({ instrumentAnthropic: (c: any) => c, withFeature: (_n: string, fn: () => any) => fn() }));
vi.mock('../src/lib/alerts.js', () => ({ reportAlert: vi.fn() }));

const coaching = await import('../src/services/coachingService.js');
const balance = () => db.coaching_credits![0].balance;

beforeEach(() => {
  db.coaching_credits = [{ id: 'credit', user_id: 'u', balance: 3 }];
  db.coaching_sessions = [];
});

describe('coaching credit accounting under simultaneous requests', () => {
  it('ending one session many times at once refunds one credit', async () => {
    const { sessionId } = await coaching.startSession('u', 'rec', 'sales_discovery');
    expect(balance()).toBe(2);
    const results = await Promise.all(Array.from({ length: 6 }, () => coaching.endSession(sessionId)));
    expect(results.filter((r) => r.refunded)).toHaveLength(1);
    expect(balance()).toBe(3);
  });

  it('every session that starts costs one credit, so refunds cannot add up to more than was spent', async () => {
    const started = await Promise.allSettled(['a', 'b', 'c', 'd', 'e'].map((r) => coaching.startSession('u', r, 'sales_discovery')));
    const ids = started.flatMap((s) => (s.status === 'fulfilled' ? [s.value.sessionId] : []));
    expect(ids.length).toBeGreaterThan(0);
    expect(balance()).toBe(3 - ids.length);
    await Promise.all(ids.map((id) => coaching.endSession(id)));
    expect(balance()).toBe(3);
  });
});
