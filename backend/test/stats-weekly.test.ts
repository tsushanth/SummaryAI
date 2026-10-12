import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

type Call = { table: string; ops: [string, ...any[]][] };
const queues: Record<string, any[]> = {};
const calls: Call[] = [];
function builder(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const q: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          const result = (queues[table] || []).shift() ?? { data: null, error: null };
          return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
        }
        return (...args: any[]) => {
          call.ops.push([prop, ...args]);
          return q;
        };
      },
    }
  );
  return q;
}

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: vi.fn((t: string) => builder(t)) } }));
vi.mock('../src/config/index.js', () => ({ config: { NODE_ENV: 'development' } }));
vi.mock('../src/lib/failureReporter.js', () => ({ reportBackendError: vi.fn() }));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1' };
    next();
  },
}));

const { default: router, summarizeWeek } = await import('../src/routes/stats.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

async function get(path: string) {
  const app = express();
  app.use('/api/stats', router);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  for (const k of Object.keys(queues)) delete queues[k];
  calls.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('summarizeWeek', () => {
  it('sums durations, ignoring null/negative', () => {
    expect(summarizeWeek([{ duration_seconds: 1800 }, { duration_seconds: 5400 }, { duration_seconds: null }, { duration_seconds: -5 }])).toEqual({
      meetings: 4,
      seconds_recorded: 7200,
      hours_recorded: 2,
    });
  });
});

describe('GET /api/stats/weekly', () => {
  it('returns user-scoped weekly totals', async () => {
    queue('recordings', { data: [{ duration_seconds: 3600 }, { duration_seconds: 1800 }], error: null });
    queue('todos', { data: null, error: null, count: 4 });
    const res = await get('/api/stats/weekly');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ meetings: 2, hours_recorded: 1.5, action_items: 4 });
    for (const c of calls) {
      expect(c.ops.some((o) => o[0] === 'eq' && o[1] === 'user_id' && o[2] === 'user-1')).toBe(true);
    }
  });

  it('returns 500 JSON on db error', async () => {
    queue('recordings', { data: null, error: { message: 'boom' } });
    const res = await get('/api/stats/weekly');
    expect(res.status).toBe(500);
  });
});

function queue(t: string, ...r: any[]) {
  (queues[t] ||= []).push(...r);
}
