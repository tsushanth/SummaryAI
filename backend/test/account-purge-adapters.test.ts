import { describe, it, expect, vi, beforeEach } from 'vitest';

const log: string[] = [];
let missing = new Set<string>();
let tree: Record<string, { name: string; id: string | null }[]> = {};

function table(name: string) {
  const q: any = {};
  q.delete = vi.fn(() => q);
  q.select = vi.fn(() => q);
  q.eq = vi.fn((col: string, val: string) => {
    log.push(`${name}.${col}=${val}`);
    return q;
  });
  q.then = (res: any, rej: any) =>
    Promise.resolve(missing.has(name) ? { count: null, error: { code: '42P01', message: 'relation does not exist' } } : { count: 2, error: null }).then(res, rej);
  return q;
}

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((name: string) => table(name)),
    storage: {
      from: () => ({
        list: async (prefix: string, opts: { offset: number }) => ({ data: opts.offset === 0 ? tree[prefix] ?? [] : [], error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    auth: { admin: { deleteUser: vi.fn(async () => ({ error: { status: 404, message: 'User not found' } })) } },
  },
}));
vi.mock('../src/config/index.js', () => ({ config: { STORAGE_BUCKET_AUDIO: 'a', STORAGE_BUCKET_EXPORTS: 'e', ACCOUNT_PURGE_DRY_RUN: false } }));
vi.mock('../src/services/recallService.js', () => ({ RecallService: {} }));
vi.mock('../src/services/twilioService.js', () => ({ TwilioService: {} }));
vi.mock('../src/lib/alerts.js', () => ({ reportAlert: vi.fn() }));
vi.mock('../src/lib/loopMonitor.js', () => ({ registerLoop: vi.fn(), runLoopPass: vi.fn() }));

const { createPurgeDeps, USER_TABLES } = await import('../src/services/accountPurgeAdapters.js');

beforeEach(() => { log.length = 0; missing = new Set(); tree = {}; });

describe('purge adapters', () => {
  it('every row delete is scoped to the one user id, children before profiles', async () => {
    const deps = createPurgeDeps();
    const res = await deps.db.deleteRows('U1');
    expect(log).toHaveLength(USER_TABLES.length);
    expect(log.every((l) => l.endsWith('=U1'))).toBe(true);
    expect(USER_TABLES[USER_TABLES.length - 1].table).toBe('profiles');
    expect(res.deleted).toBe(2 * USER_TABLES.length);
    expect(res.failedTables).toEqual([]);
  });

  it('a table missing from the live schema is skipped, not reported as a failure', async () => {
    missing = new Set(['scheduled_bots']);
    const res = await createPurgeDeps().db.deleteRows('U1');
    expect(res.failedTables).toEqual([]);
    expect(res.deleted).toBe(2 * (USER_TABLES.length - 1));
  });

  it('auth user already gone is treated as success', async () => {
    expect(await createPurgeDeps().db.deleteAuthUser('U1')).toBe('not_found');
  });

  it('listPrefix recurses into folders and returns full paths', async () => {
    tree = { U1: [{ name: 'a.m4a', id: 'x' }, { name: 'sub', id: null }], 'U1/sub': [{ name: 'b.mp3', id: 'y' }] };
    expect((await createPurgeDeps().storage.listPrefix('a', 'U1')).sort()).toEqual(['U1/a.m4a', 'U1/sub/b.mp3']);
  });
});
