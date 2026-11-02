import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

// ---- fake supabase: recordings rows for the user + a fake storage bucket ----------------------
const state = {
  rows: [] as { id: string; file_path: string | null }[],
  removeCalls: [] as { bucket: string; paths: string[] }[],
  removeError: null as null | { message: string },
  order: [] as string[], // every side effect, in order
  authError: null as null | { message: string },
  selectedUser: '' as string,
};

function recordingsChain() {
  const q: any = {};
  let rangeFrom = 0;
  let rangeTo = 0;
  q.select = vi.fn(() => q);
  q.eq = vi.fn((col: string, val: string) => {
    if (col === 'user_id') state.selectedUser = val;
    return q;
  });
  q.order = vi.fn(() => q);
  q.range = vi.fn((from: number, to: number) => {
    rangeFrom = from;
    rangeTo = to;
    return q;
  });
  q.delete = vi.fn(() => {
    state.order.push('db:delete recordings');
    return q;
  });
  q.then = (res: any, rej: any) =>
    Promise.resolve({ data: state.rows.slice(rangeFrom, rangeTo + 1), error: null }).then(res, rej);
  return q;
}

function genericChain(table: string) {
  const q: any = {};
  q.delete = vi.fn(() => {
    state.order.push(`db:delete ${table}`);
    return q;
  });
  q.eq = vi.fn(() => q);
  q.then = (res: any, rej: any) => Promise.resolve({ data: null, error: null }).then(res, rej);
  return q;
}

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((t: string) => (t === 'recordings' ? recordingsChain() : genericChain(t))),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          state.order.push('storage:remove');
          state.removeCalls.push({ bucket, paths });
          return { data: null, error: state.removeError };
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: async () => {
          state.order.push('auth:deleteUser');
          return { error: state.authError };
        },
      },
    },
  },
}));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => ((req.user = { id: 'user-1' }), next()),
}));
vi.mock('../src/config/index.js', () => ({ config: { STORAGE_BUCKET_AUDIO: 'recordings-audio' } }));

const { removeUserAudioFiles } = await import('../src/services/accountDeletion.js');
const { default: router } = await import('../src/routes/users.js');
const { supabaseAdmin } = await import('../src/lib/supabase.js');

beforeEach(() => {
  state.rows = [];
  state.removeCalls = [];
  state.removeError = null;
  state.order = [];
  state.authError = null;
  state.selectedUser = '';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('removeUserAudioFiles', () => {
  it('removes every file_path of the user from the audio bucket', async () => {
    state.rows = [
      { id: 'a', file_path: 'user-1/a.webm' },
      { id: 'b', file_path: 'user-1/b.m4a' },
    ];
    const n = await removeUserAudioFiles(supabaseAdmin as any, 'recordings-audio', 'user-1');
    expect(n).toBe(2);
    expect(state.selectedUser).toBe('user-1');
    expect(state.removeCalls).toEqual([{ bucket: 'recordings-audio', paths: ['user-1/a.webm', 'user-1/b.m4a'] }]);
  });

  it('skips recordings without a file (bot runs that never produced audio)', async () => {
    state.rows = [
      { id: 'a', file_path: null },
      { id: 'b', file_path: '' },
      { id: 'c', file_path: 'user-1/c.webm' },
    ];
    expect(await removeUserAudioFiles(supabaseAdmin as any, 'recordings-audio', 'user-1')).toBe(1);
    expect(state.removeCalls[0].paths).toEqual(['user-1/c.webm']);
  });

  it('does not call storage at all when there is nothing to remove', async () => {
    state.rows = [{ id: 'a', file_path: null }];
    expect(await removeUserAudioFiles(supabaseAdmin as any, 'recordings-audio', 'user-1')).toBe(0);
    expect(state.removeCalls).toEqual([]);
  });

  it('pages through the recordings and removes in batches', async () => {
    state.rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, file_path: `user-1/${i}.webm` }));
    const n = await removeUserAudioFiles(supabaseAdmin as any, 'recordings-audio', 'user-1', { pageSize: 2, batchSize: 2 });
    expect(n).toBe(5);
    expect(state.removeCalls.map((c) => c.paths)).toEqual([
      ['user-1/0.webm', 'user-1/1.webm'],
      ['user-1/2.webm', 'user-1/3.webm'],
      ['user-1/4.webm'],
    ]);
  });

  it('throws when storage refuses, so the caller can stop before dropping the rows that hold the paths', async () => {
    state.rows = [{ id: 'a', file_path: 'user-1/a.webm' }];
    state.removeError = { message: 'storage down' };
    await expect(removeUserAudioFiles(supabaseAdmin as any, 'recordings-audio', 'user-1')).rejects.toThrow(/storage down/);
  });
});

async function deleteAccount() {
  const app = express();
  app.use('/api/users', router);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/users/account`, { method: 'DELETE' });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

describe('DELETE /api/users/account', () => {
  it('removes the audio files BEFORE the recording rows and the auth user', async () => {
    state.rows = [{ id: 'a', file_path: 'user-1/a.webm' }];
    const r = await deleteAccount();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true });
    expect(state.removeCalls).toEqual([{ bucket: 'recordings-audio', paths: ['user-1/a.webm'] }]);
    const i = (s: string) => state.order.indexOf(s);
    expect(i('storage:remove')).toBeGreaterThanOrEqual(0);
    expect(i('storage:remove')).toBeLessThan(i('db:delete recordings'));
    expect(i('db:delete recordings')).toBeLessThan(i('auth:deleteUser'));
  });

  it('a storage failure stops the deletion: no rows deleted, no auth user deleted, 500 so the user can retry', async () => {
    state.rows = [{ id: 'a', file_path: 'user-1/a.webm' }];
    state.removeError = { message: 'storage down' };
    const r = await deleteAccount();
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('STORAGE_DELETE_FAILED');
    expect(state.order).toEqual(['storage:remove']);
  });

  it('an account with no recordings still deletes normally', async () => {
    const r = await deleteAccount();
    expect(r.status).toBe(200);
    expect(state.removeCalls).toEqual([]);
    expect(state.order).toContain('auth:deleteUser');
  });
});
