import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

// Each call to .from('recordings') returns a chainable query that resolves to the next queued result.
const results: any[] = [];
const calls: { head?: boolean }[] = [];

function chain(result: any) {
  const q: any = {};
  for (const m of ['select', 'eq', 'order', 'range']) q[m] = vi.fn(() => q);
  q.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return q;
}

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const q = chain(results.shift());
      const select = q.select;
      q.select = vi.fn((cols: string, opts: any) => {
        calls.push({ head: opts?.head });
        return select(cols, opts);
      });
      return q;
    }),
  },
}));

vi.mock('../src/middleware/auth.js', () => ({
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1' };
    next();
  },
  authenticate: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../src/services/processingService.js', () => ({ triggerProcessing: vi.fn() }));
vi.mock('../src/routes/questions.js', async () => ({ default: (await import('express')).Router() }));
vi.mock('../src/config/index.js', () => ({
  config: { MAX_RECORDING_DURATION_SECONDS: 14400, MAX_AUDIO_FILE_SIZE_MB: 500 },
}));

const { default: router } = await import('../src/routes/recordings.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

async function get(path: string) {
  const app = express();
  app.use('/api/recordings', router);
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
  results.length = 0;
  calls.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/recordings', () => {
  it('returns rows and meta for a normal page', async () => {
    results.push({ data: [{ id: 'a' }], error: null, count: 1 });
    const { status, body } = await get('/api/recordings?page=1&per_page=20');
    expect(status).toBe(200);
    expect(body.recordings).toHaveLength(1);
    expect(body.meta).toMatchObject({ page: 1, total_count: 1, total_pages: 1 });
  });

  it('returns an empty page, not 500, when the offset is past the last row (PGRST103)', async () => {
    results.push({
      data: null,
      error: { code: 'PGRST103', message: 'Requested range not satisfiable' },
      count: null,
    });
    results.push({ data: null, error: null, count: 5 });
    const { status, body } = await get('/api/recordings?page=2&per_page=20');
    expect(status).toBe(200);
    expect(body.recordings).toEqual([]);
    expect(body.meta).toMatchObject({ page: 2, total_count: 5, total_pages: 1 });
    expect(calls[1].head).toBe(true);
  });

  it('still returns 500 for other database errors', async () => {
    results.push({ data: null, error: { code: '42P01', message: 'boom' }, count: null });
    const { status } = await get('/api/recordings?page=1');
    expect(status).toBe(500);
  });

  it('returns 500 if the fallback count query fails', async () => {
    results.push({ data: null, error: { code: 'PGRST103' }, count: null });
    results.push({ data: null, error: { code: 'XX000' }, count: null });
    const { status } = await get('/api/recordings?page=2');
    expect(status).toBe(500);
  });
});
