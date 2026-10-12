import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

// ---- Fake supabase: per-table queued results, every builder call is recorded ----
type Call = { table: string; ops: [string, ...any[]][] };
const queues: Record<string, any[]> = {};
const calls: Call[] = [];

function queue(table: string, ...results: any[]) {
  (queues[table] ||= []).push(...results);
}

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

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1' };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1' };
    next();
  },
}));
vi.mock('../src/services/processingService.js', () => ({ triggerProcessing: vi.fn() }));
vi.mock('../src/routes/questions.js', async () => ({ default: (await import('express')).Router() }));
vi.mock('../src/config/index.js', () => ({
  config: { MAX_RECORDING_DURATION_SECONDS: 14400, MAX_AUDIO_FILE_SIZE_MB: 500, WEB_APP_URL: 'https://web.example' },
}));

const { foldersRouter, tagsRouter } = await import('../src/routes/folders.js');
const { recordingSharesRouter, publicSharesRouter } = await import('../src/routes/shares.js');
const { default: searchRouter, escapeLike } = await import('../src/routes/search.js');
const { default: recordingsRouter } = await import('../src/routes/recordings.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { generateShareToken, hashShareToken, normalizeTags, SHARE_TOKEN_REGEX, createRateLimiter } =
  await import('../src/lib/shareToken.js');

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

async function request(method: string, path: string, body?: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/folders', foldersRouter);
  app.use('/api/tags', tagsRouter);
  app.use('/api/recordings/:id/shares', recordingSharesRouter);
  app.use('/api/public/shares', publicSharesRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/recordings', recordingsRouter);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  } finally {
    server.close();
  }
}

const hasEq = (c: Call, col: string, val: any) =>
  c.ops.some((o) => o[0] === 'eq' && o[1] === col && o[2] === val);

beforeEach(() => {
  for (const k of Object.keys(queues)) delete queues[k];
  calls.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('shareToken helpers', () => {
  it('generates 256-bit url-safe tokens that match the validator and hash to 64 hex chars', () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).toMatch(SHARE_TOKEN_REGEX);
    expect(a).not.toBe(b);
    expect(hashShareToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(a)).not.toBe(a);
  });

  it('normalizes tags: trims, dedupes case-insensitively, drops empties', () => {
    expect(normalizeTags(['  Q3  plan ', 'q3 plan', '', 'Sales'])).toEqual(['Q3 plan', 'Sales']);
  });

  it('rate limiter blocks after max and resets after the window', () => {
    let now = 1000;
    const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => now });
    const mk = () => {
      const res: any = { statusCode: 200, setHeader: vi.fn(), status(c: number) { this.statusCode = c; return this; }, json: vi.fn() };
      const next = vi.fn();
      limiter({ headers: { 'fly-client-ip': '1.1.1.1' }, ip: 'x' } as any, res, next);
      return { res, next };
    };
    expect(mk().next).toHaveBeenCalled();
    expect(mk().next).toHaveBeenCalled();
    expect(mk().res.statusCode).toBe(429);
    now += 1001;
    expect(mk().next).toHaveBeenCalled();
  });

  it('escapes LIKE wildcards in search input', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('folders', () => {
  it('lists only the caller folders and counts recordings per folder', async () => {
    queue('folders', { data: [{ id: UUID, name: 'A' }], error: null });
    queue('recordings', { data: [{ folder_id: UUID }, { folder_id: UUID }], error: null });
    const { status, body } = await request('GET', '/api/folders');
    expect(status).toBe(200);
    expect(body.folders[0].recording_count).toBe(2);
    for (const c of calls) expect(hasEq(c, 'user_id', 'user-1')).toBe(true);
  });

  it('creates a folder for the caller and maps duplicates to 409', async () => {
    queue('folders', { data: { id: UUID, name: 'A' }, error: null });
    const ok = await request('POST', '/api/folders', { name: ' A ' });
    expect(ok.status).toBe(201);
    expect(calls[0].ops.find((o) => o[0] === 'insert')![1]).toEqual({ user_id: 'user-1', name: 'A' });

    queue('folders', { data: null, error: { code: '23505' } });
    expect((await request('POST', '/api/folders', { name: 'A' })).status).toBe(409);
    expect((await request('POST', '/api/folders', { name: '   ' })).status).toBe(400);
  });

  it('rename and delete are scoped to user_id and 404 when not found', async () => {
    queue('folders', { data: null, error: null });
    expect((await request('PATCH', `/api/folders/${UUID}`, { name: 'B' })).status).toBe(404);
    expect(hasEq(calls[0], 'user_id', 'user-1')).toBe(true);

    queue('folders', { data: [], error: null });
    expect((await request('DELETE', `/api/folders/${UUID}`)).status).toBe(404);
    expect(hasEq(calls[1], 'user_id', 'user-1')).toBe(true);

    queue('folders', { data: [{ id: UUID }], error: null });
    expect((await request('DELETE', `/api/folders/${UUID}`)).status).toBe(204);
    expect((await request('DELETE', '/api/folders/not-a-uuid')).status).toBe(404);
  });

  it('tags are aggregated from the caller recordings only', async () => {
    queue('recordings', { data: [{ tags: ['a', 'B'] }, { tags: ['A'] }], error: null });
    const { body } = await request('GET', '/api/tags');
    expect(body.tags[0]).toEqual({ tag: 'a', count: 2 });
    expect(hasEq(calls[0], 'user_id', 'user-1')).toBe(true);
  });
});

describe('recordings organization', () => {
  it('list applies folder/tag/favorite/date filters and user scope', async () => {
    queue('recordings', { data: [], error: null, count: 0 });
    const from = '2026-10-01T00:00:00.000Z';
    const { status } = await request(
      'GET',
      `/api/recordings?folder_id=${UUID}&tag=work&favorite=true&from=${encodeURIComponent(from)}`
    );
    expect(status).toBe(200);
    const ops = calls[0].ops;
    expect(hasEq(calls[0], 'user_id', 'user-1')).toBe(true);
    expect(hasEq(calls[0], 'folder_id', UUID)).toBe(true);
    expect(ops.some((o) => o[0] === 'contains' && o[1] === 'tags')).toBe(true);
    expect(hasEq(calls[0], 'is_favorite', true)).toBe(true);
    expect(ops.some((o) => o[0] === 'gte' && o[1] === 'created_at')).toBe(true);
  });

  it('folder_id=none filters unfiled recordings', async () => {
    queue('recordings', { data: [], error: null, count: 0 });
    await request('GET', '/api/recordings?folder_id=none');
    expect(calls[0].ops.some((o) => o[0] === 'is' && o[1] === 'folder_id' && o[2] === null)).toBe(true);
  });

  it('PATCH folder_id rejects a folder the caller does not own', async () => {
    queue('recordings', { data: { id: UUID }, error: null }); // ownership check
    queue('folders', { data: null, error: null }); // folder not owned
    const { status } = await request('PATCH', `/api/recordings/${UUID}`, { folder_id: UUID2 });
    expect(status).toBe(404);
    const folderCall = calls.find((c) => c.table === 'folders')!;
    expect(hasEq(folderCall, 'user_id', 'user-1')).toBe(true);
    expect(calls.some((c) => c.ops.some((o) => o[0] === 'update'))).toBe(false);
  });

  it('PATCH normalizes tags and scopes the update by user_id', async () => {
    queue('recordings', { data: { id: UUID }, error: null }, { data: { id: UUID, tags: ['x'] }, error: null });
    const { status } = await request('PATCH', `/api/recordings/${UUID}`, { tags: [' x ', 'X', ''] });
    expect(status).toBe(200);
    const upd = calls.find((c) => c.ops.some((o) => o[0] === 'update'))!;
    expect(upd.ops.find((o) => o[0] === 'update')![1].tags).toEqual(['x']);
    expect(hasEq(upd, 'user_id', 'user-1')).toBe(true);
  });
});

describe('share links (owner)', () => {
  it('create returns the token once, stores only its hash, and requires ownership', async () => {
    queue('recordings', { data: { id: UUID }, error: null });
    queue('recording_shares', { data: { id: UUID2, recording_id: UUID }, error: null });
    const { status, body } = await request('POST', `/api/recordings/${UUID}/shares`, {
      include_transcript: true,
      expires_in_days: 7,
    });
    expect(status).toBe(201);
    expect(body.token).toMatch(SHARE_TOKEN_REGEX);
    expect(body.url).toBe(`https://web.example/share/${body.token}`);
    const insert = calls.find((c) => c.table === 'recording_shares')!.ops.find((o) => o[0] === 'insert')![1];
    expect(insert.token_hash).toBe(hashShareToken(body.token));
    expect(JSON.stringify(insert)).not.toContain(body.token);
    expect(insert.user_id).toBe('user-1');
    expect(insert.include_transcript).toBe(true);
    expect(insert.expires_at).toBeTruthy();
    expect(hasEq(calls[0], 'user_id', 'user-1')).toBe(true);
  });

  it('create 404s for a recording the caller does not own', async () => {
    queue('recordings', { data: null, error: null });
    expect((await request('POST', `/api/recordings/${UUID}/shares`, {})).status).toBe(404);
    expect(calls.some((c) => c.table === 'recording_shares')).toBe(false);
  });

  it('revoke is scoped to user and recording, and 404s when nothing matched', async () => {
    queue('recording_shares', { data: [], error: null });
    expect((await request('DELETE', `/api/recordings/${UUID}/shares/${UUID2}`)).status).toBe(404);
    const c = calls[0];
    expect(hasEq(c, 'user_id', 'user-1')).toBe(true);
    expect(hasEq(c, 'recording_id', UUID)).toBe(true);
    expect(c.ops.some((o) => o[0] === 'update' && o[1].revoked_at)).toBe(true);

    queue('recording_shares', { data: [{ id: UUID2 }], error: null });
    expect((await request('DELETE', `/api/recordings/${UUID}/shares/${UUID2}`)).status).toBe(204);
  });

  it('list never returns token material', async () => {
    queue('recordings', { data: { id: UUID }, error: null });
    queue('recording_shares', { data: [{ id: UUID2 }], error: null });
    await request('GET', `/api/recordings/${UUID}/shares`);
    const select = calls[1].ops.find((o) => o[0] === 'select')![1] as string;
    expect(select).not.toContain('token');
  });
});

describe('share links (public)', () => {
  const token = generateShareToken();
  const validShare = {
    id: UUID2,
    recording_id: UUID,
    user_id: 'owner',
    include_transcript: false,
    expires_at: null,
    revoked_at: null,
  };

  it('rejects malformed tokens with the generic 404 without touching the database', async () => {
    const r = await request('GET', '/api/public/shares/short');
    expect(r.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('unknown, revoked and expired tokens are indistinguishable 404s', async () => {
    queue('recording_shares', { data: null, error: null });
    const unknown = await request('GET', `/api/public/shares/${token}`);
    queue('recording_shares', { data: { ...validShare, revoked_at: new Date().toISOString() }, error: null });
    const revoked = await request('GET', `/api/public/shares/${token}`);
    queue('recording_shares', { data: { ...validShare, expires_at: new Date(Date.now() - 1000).toISOString() }, error: null });
    const expired = await request('GET', `/api/public/shares/${token}`);
    for (const r of [unknown, revoked, expired]) expect(r.status).toBe(404);
    expect(revoked.body).toEqual(unknown.body);
    expect(expired.body).toEqual(unknown.body);
    // lookup is by hash, never by the raw token
    const lookup = calls[0].ops.find((o) => o[0] === 'eq' && o[1] === 'token_hash')!;
    expect(lookup[2]).toBe(hashShareToken(token));
  });

  it('returns only chosen fields: no transcript unless opted in, no user data', async () => {
    queue('recording_shares', { data: validShare, error: null });
    queue('recordings', {
      data: { id: UUID, title: 'T', created_at: 'c', duration_seconds: 5, language: 'en' },
      error: null,
    });
    queue('summaries', {
      data: { summary: 'S', key_points: ['k'], action_items: [{ text: 'do it', assignee: 'x' }, 'plain'], topics: ['t'] },
      error: null,
    });
    const r = await request('GET', `/api/public/shares/${token}`);
    expect(r.status).toBe(200);
    expect(r.body.transcript).toBeNull();
    expect(r.body.summary.action_items).toEqual(['do it', 'plain']);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-robots-tag')).toContain('noindex');
    const json = JSON.stringify(r.body);
    expect(json).not.toContain('owner');
    expect(json).not.toContain('user_id');
    expect(json).not.toContain('file_path');
    expect(calls.some((c) => c.table === 'transcripts')).toBe(false);
    // recording is re-checked against the share owner
    const recCall = calls.find((c) => c.table === 'recordings')!;
    expect(hasEq(recCall, 'user_id', 'owner')).toBe(true);
  });

  it('includes the transcript with custom speaker names when opted in', async () => {
    queue('recording_shares', { data: { ...validShare, include_transcript: true }, error: null });
    queue('recordings', { data: { id: UUID, title: 'T' }, error: null });
    queue('summaries', { data: null, error: null });
    queue('transcripts', {
      data: {
        segments: [{ speaker_index: 0, speaker_label: 'Speaker 1', text: 'hi', start_time: 1.5, confidence: 0.9 }],
        speaker_names: { '0': 'Ana' },
      },
      error: null,
    });
    const r = await request('GET', `/api/public/shares/${token}`);
    expect(r.body.transcript.segments).toEqual([{ speaker: 'Ana', text: 'hi', start_time: 1.5 }]);
  });
});

describe('search', () => {
  it('rejects short queries and scopes every lookup to the caller', async () => {
    expect((await request('GET', '/api/search?q=a')).status).toBe(400);

    queue('recordings', { data: [{ id: UUID, title: 'Budget' }], error: null });
    queue('summaries', { data: [], error: null });
    queue('transcripts', { data: [{ recording_id: UUID2, full_text: 'we talked about budget today' }], error: null });
    queue('recordings', {
      data: [
        { id: UUID, title: 'Budget' },
        { id: UUID2, title: 'Other' },
      ],
      error: null,
    });
    const r = await request('GET', '/api/search?q=budget');
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: any) => x.match).sort()).toEqual(['title', 'transcript']);
    for (const c of calls) {
      const scoped = hasEq(c, 'user_id', 'user-1') || hasEq(c, 'recordings.user_id', 'user-1');
      expect(scoped).toBe(true);
    }
  });
});
