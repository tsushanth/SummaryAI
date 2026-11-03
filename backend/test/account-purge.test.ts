import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runAccountPurge,
  retryPendingPurges,
  hashUserRef,
  LedgerUnavailableError,
  MAX_PURGE_ATTEMPTS,
  type PurgeDeps,
  type PurgeLedger,
  type LedgerRow,
  type PendingWork,
  type PurgeCounts,
  type PurgeStatus,
} from '../src/services/accountPurge.js';

const AUDIO = 'recordings-audio';
const EXPORTS = 'exports';
const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------- fakes
class World {
  events: string[] = [];
  storage = new Map<string, Set<string>>([[AUDIO, new Set()], [EXPORTS, new Set()]]);
  recordings: { id: string; user: string; file_path: string | null }[] = [];
  botRuns: { user: string; recall_bot_id: string; status: string }[] = [];
  twilioSids: { user: string; sid: string }[] = [];
  rowsUsers = new Set<string>(); // users whose generic rows exist
  authUsers = new Set<string>();
  recallMedia = new Set<string>();
  twilioRecs = new Set<string>();
  failStorageBatchAt: number | null = null; // 1-based remove() call index that throws
  removeCalls = 0;
  recallFail = new Set<string>();
  recallInProgress = new Set<string>();
  twilioFail = new Set<string>();
  authFailTimes = 0;
  residualOnce: { bucket: string; path: string } | null = null;
  alerts: { code: string; ctx: Record<string, unknown> }[] = [];
  stopped: string[] = [];
  put(bucket: string, path: string) { this.storage.get(bucket)!.add(path); }
  has(bucket: string, path: string) { return this.storage.get(bucket)!.has(path); }
}

class FakeLedger implements PurgeLedger {
  rows = new Map<string, LedgerRow & { lockedUntil: number }>();
  saves: Partial<LedgerRow>[] = [];
  failFirstSave = false;
  constructor(private now: () => number) {}
  async acquire(userRef: string, userId: string, leaseMs: number) {
    const cur = this.rows.get(userRef);
    if (cur && cur.lockedUntil > this.now()) return { acquired: false as const };
    const row = cur ?? { userRef, userId, status: 'running' as PurgeStatus, pending: { storage: [], recall: [], twilio: [] }, counts: emptyCounts(), attempts: 0, lockedUntil: 0 };
    row.userId = userId; row.status = 'running'; row.lockedUntil = this.now() + leaseMs;
    this.rows.set(userRef, row);
    return { acquired: true as const, row: structuredClone(row) };
  }
  async save(userRef: string, patch: Partial<LedgerRow>) {
    if (this.failFirstSave) { this.failFirstSave = false; throw new Error('ledger write failed'); }
    this.saves.push(structuredClone(patch));
    const r = this.rows.get(userRef)!;
    Object.assign(r, patch);
    if (patch.status && patch.status !== 'running') r.lockedUntil = 0;
  }
  async listRetryable(limit: number) {
    return [...this.rows.values()]
      .filter((r) => ['pending_external', 'failed', 'running'].includes(r.status) && r.userId && r.attempts < MAX_PURGE_ATTEMPTS && r.lockedUntil <= this.now() && (!r.nextAttemptAt || r.nextAttemptAt <= this.now()))
      .slice(0, limit).map((r) => ({ userId: r.userId! }));
  }
  async countNeedsAttention() { return [...this.rows.values()].filter((r) => r.status === 'needs_attention').length; }
}

function emptyCounts(): PurgeCounts {
  return { recordings: 0, storage_deleted: 0, recall_deleted: 0, twilio_deleted: 0, rows_deleted: 0, skipped_foreign_paths: 0 };
}

let clock = 1_000_000;
function makeDeps(w: World, opts: { ledger?: PurgeLedger | null; dryRun?: boolean; recallConfigured?: boolean } = {}): PurgeDeps {
  const ledger = opts.ledger === undefined ? new FakeLedger(() => clock) : opts.ledger;
  return {
    buckets: [AUDIO, EXPORTS],
    dryRun: opts.dryRun ?? false,
    removeBatchSize: 2,
    now: () => clock,
    db: {
      async collect(userId) {
        w.events.push('db.collect');
        return {
          recordings: w.recordings.filter((r) => r.user === userId).map((r) => ({ id: r.id, file_path: r.file_path })),
          botRuns: w.botRuns.filter((b) => b.user === userId).map(({ recall_bot_id, status }) => ({ recall_bot_id, status })),
          twilioSids: w.twilioSids.filter((t) => t.user === userId).map((t) => t.sid),
        };
      },
      async countRows(userId) { return w.rowsUsers.has(userId) ? { recordings: w.recordings.filter((r) => r.user === userId).length, todos: 3 } : {}; },
      async deleteRows(userId) {
        w.events.push('db.deleteRows');
        const n = w.rowsUsers.has(userId) ? 5 : 0;
        w.recordings = w.recordings.filter((r) => r.user !== userId);
        w.botRuns = w.botRuns.filter((b) => b.user !== userId);
        w.twilioSids = w.twilioSids.filter((t) => t.user !== userId);
        w.rowsUsers.delete(userId);
        return { deleted: n, failedTables: [] };
      },
      async deleteAuthUser(userId) {
        w.events.push('db.deleteAuth');
        if (w.authFailTimes > 0) { w.authFailTimes--; throw new Error('auth down'); }
        if (!w.authUsers.has(userId)) return 'not_found';
        w.authUsers.delete(userId);
        return 'deleted';
      },
    },
    storage: {
      async listPrefix(bucket, prefix) {
        w.events.push('storage.list');
        const out = [...w.storage.get(bucket)!].filter((p) => p.startsWith(`${prefix}/`));
        if (w.residualOnce && w.residualOnce.bucket === bucket && out.length === 0) {
          const r = w.residualOnce; w.residualOnce = null; w.put(bucket, r.path); return [r.path];
        }
        return out;
      },
      async remove(bucket, paths) {
        w.removeCalls++;
        w.events.push('storage.remove');
        if (w.failStorageBatchAt === w.removeCalls) throw new Error('storage 500');
        for (const p of paths) w.storage.get(bucket)!.delete(p);
      },
    },
    recall: {
      isConfigured: () => opts.recallConfigured ?? true,
      async stopBot(id) { w.stopped.push(id); },
      async deleteMedia(id) {
        w.events.push('recall.delete');
        if (w.recallFail.has(id)) throw new Error('recall 500');
        if (w.recallInProgress.has(id)) return 'in_progress';
        if (!w.recallMedia.has(id)) return 'not_found';
        w.recallMedia.delete(id);
        return 'deleted';
      },
    },
    twilio: {
      isConfigured: () => true,
      async deleteRecording(sid) {
        w.events.push('twilio.delete');
        if (w.twilioFail.has(sid)) throw new Error('twilio 500');
        if (!w.twilioRecs.has(sid)) return 'not_found';
        w.twilioRecs.delete(sid);
        return 'deleted';
      },
    },
    ledger,
    alert: (code, ctx = {}) => { w.alerts.push({ code, ctx }); },
  };
}

function seed(w: World) {
  w.authUsers.add(U); w.authUsers.add(OTHER);
  w.rowsUsers.add(U); w.rowsUsers.add(OTHER);
  w.recordings = [
    { id: 'r1', user: U, file_path: `${U}/r1.m4a` },
    { id: 'r2', user: U, file_path: `${U}/r2.pdf` },
    { id: 'r3', user: U, file_path: `${U}/meeting-9.mp4` }, // bot media downloaded from Recall
    { id: 'r4', user: U, file_path: `${U}/phone-call-1.mp3` },
    { id: 'r5', user: U, file_path: null }, // pending recording, no file
    { id: 'o1', user: OTHER, file_path: `${OTHER}/o1.m4a` },
  ];
  for (const r of w.recordings) if (r.file_path) w.put(AUDIO, r.file_path);
  w.put(AUDIO, `${U}/orphan-never-in-db.m4a`); // upload whose row was already removed
  w.put(EXPORTS, `${U}/export-1.pdf`);
  w.botRuns = [
    { user: U, recall_bot_id: 'bot-done', status: 'completed' },
    { user: U, recall_bot_id: 'bot-live', status: 'recording' },
    { user: OTHER, recall_bot_id: 'bot-other', status: 'completed' },
  ];
  w.recallMedia = new Set(['bot-done', 'bot-live', 'bot-other']);
  w.twilioSids = [{ user: U, sid: 'RE_u1' }, { user: OTHER, sid: 'RE_o1' }];
  w.twilioRecs = new Set(['RE_u1', 'RE_o1']);
}

let w: World;
beforeEach(() => { w = new World(); clock = 1_000_000; });

const userObjects = (bucket: string) => [...w.storage.get(bucket)!].filter((p) => p.startsWith(`${U}/`));

// ---------------------------------------------------------------- tests
describe('runAccountPurge', () => {
  it('deletes storage, provider media and rows for the user, never another user, in order', async () => {
    seed(w);
    const deps = makeDeps(w);
    const res = await runAccountPurge(U, deps);

    expect(res.status).toBe('complete');
    expect(userObjects(AUDIO)).toEqual([]);
    expect(userObjects(EXPORTS)).toEqual([]);
    expect(w.has(AUDIO, `${OTHER}/o1.m4a`)).toBe(true);
    expect(w.recallMedia.has('bot-done')).toBe(false);
    expect(w.recallMedia.has('bot-live')).toBe(false);
    expect(w.recallMedia.has('bot-other')).toBe(true);
    expect(w.twilioRecs.has('RE_u1')).toBe(false);
    expect(w.twilioRecs.has('RE_o1')).toBe(true);
    expect(w.authUsers.has(U)).toBe(false);
    expect(w.authUsers.has(OTHER)).toBe(true);
    expect(w.rowsUsers.has(OTHER)).toBe(true);
    expect(w.stopped).toEqual(['bot-live']); // only non-terminal bots are told to stop

    const firstRemove = w.events.indexOf('storage.remove');
    const rows = w.events.indexOf('db.deleteRows');
    const auth = w.events.indexOf('db.deleteAuth');
    expect(w.events.indexOf('db.collect')).toBeLessThan(firstRemove);
    expect(firstRemove).toBeLessThan(w.events.indexOf('recall.delete'));
    expect(w.events.indexOf('recall.delete')).toBeLessThan(w.events.indexOf('twilio.delete'));
    expect(w.events.indexOf('twilio.delete')).toBeLessThan(rows);
    expect(rows).toBeLessThan(auth);

    expect(res.counts.storage_deleted).toBe(6); // r1 r2 r3 r4 + orphan upload + export
  });

  it('persists the plan to the ledger BEFORE the first destructive call', async () => {
    seed(w);
    const ledger = new FakeLedger(() => clock);
    const origSave = ledger.save.bind(ledger);
    let planSavedBeforeRemove = false;
    ledger.save = async (ref, patch) => {
      if (patch.pending && patch.pending.storage.length > 0 && !w.events.includes('storage.remove')) planSavedBeforeRemove = true;
      return origSave(ref, patch);
    };
    await runAccountPurge(U, makeDeps(w, { ledger }));
    expect(planSavedBeforeRemove).toBe(true);
  });

  it('ledger ends complete with user id cleared, counts only (no paths or content)', async () => {
    seed(w);
    const ledger = new FakeLedger(() => clock);
    await runAccountPurge(U, makeDeps(w, { ledger }));
    const row = ledger.rows.get(hashUserRef(U))!;
    expect(row.status).toBe('complete');
    expect(row.userId).toBeNull();
    expect(row.pending).toEqual({ storage: [], recall: [], twilio: [] });
    expect(JSON.stringify(row)).not.toContain('.m4a');
    expect(row.counts.recordings).toBe(5);
  });

  it('provider failure does not block local deletion; retry finishes it (Recall)', async () => {
    seed(w);
    w.recallFail.add('bot-done');
    const ledger = new FakeLedger(() => clock);
    const res = await runAccountPurge(U, makeDeps(w, { ledger }));

    expect(res.status).toBe('pending_external');
    expect(res.pending.recall).toBe(1);
    expect(w.authUsers.has(U)).toBe(false); // local deletion went ahead
    expect(w.recordings.some((r) => r.user === U)).toBe(false);
    expect(w.recallMedia.has('bot-done')).toBe(true); // still at Recall
    expect(w.recallMedia.has('bot-live')).toBe(false);
    expect(w.alerts.some((a) => a.code === 'RECALL_DELETE_FAILED')).toBe(true);
    // alerts carry counts/classes only, never the user id or bot id
    expect(JSON.stringify(w.alerts)).not.toContain(U);
    expect(JSON.stringify(w.alerts)).not.toContain('bot-done');
    const row = ledger.rows.get(hashUserRef(U))!;
    expect(row.status).toBe('pending_external');
    expect(row.attempts).toBe(1);

    // provider recovers; the retry loop completes it without the DB rows (already gone)
    w.recallFail.clear();
    clock += 24 * 3600_000;
    const retry = await retryPendingPurges(makeDeps(w, { ledger }));
    expect(retry.processed).toBe(1);
    expect(w.recallMedia.has('bot-done')).toBe(false);
    expect(ledger.rows.get(hashUserRef(U))!.status).toBe('complete');
    expect(ledger.rows.get(hashUserRef(U))!.userId).toBeNull();
  });

  it('Recall "in progress" and Twilio failures stay pending, others complete', async () => {
    seed(w);
    w.recallInProgress.add('bot-live');
    w.twilioFail.add('RE_u1');
    const res = await runAccountPurge(U, makeDeps(w));
    expect(res.status).toBe('pending_external');
    expect(res.pending).toEqual({ storage: 0, recall: 1, twilio: 1 });
    expect(w.recallMedia.has('bot-done')).toBe(false);
  });

  it('storage partial failure: resumes and removes only what is left', async () => {
    seed(w);
    w.failStorageBatchAt = 2; // batch size 2, 6 objects => 3 batches; 2nd throws
    const ledger = new FakeLedger(() => clock);
    const res = await runAccountPurge(U, makeDeps(w, { ledger }));
    expect(res.status).toBe('pending_external');
    expect(res.pending.storage).toBeGreaterThan(0);
    expect(w.authUsers.has(U)).toBe(false);
    const remaining = userObjects(AUDIO).length + userObjects(EXPORTS).length;
    expect(remaining).toBe(res.pending.storage);

    w.failStorageBatchAt = null;
    w.removeCalls = 0;
    clock += 24 * 3600_000;
    await retryPendingPurges(makeDeps(w, { ledger }));
    expect(userObjects(AUDIO)).toEqual([]);
    expect(userObjects(EXPORTS)).toEqual([]);
    expect(w.removeCalls).toBe(3); // 3 audio left in 2 batches + 1 export; the two batches already deleted are not repeated
    expect(remaining).toBe(4);
    expect(ledger.rows.get(hashUserRef(U))!.status).toBe('complete');
    expect(w.has(AUDIO, `${OTHER}/o1.m4a`)).toBe(true);
  });

  it('objects that survive a remove (verification pass) are kept pending, not reported as deleted', async () => {
    seed(w);
    // after everything is removed a straggler appears under the user prefix
    w.residualOnce = { bucket: AUDIO, path: `${U}/late-upload.m4a` };
    const res = await runAccountPurge(U, makeDeps(w));
    expect(res.status).toBe('pending_external');
    expect(res.pending.storage).toBe(1);
  });

  it('is idempotent: a second run after completion is a harmless no-op', async () => {
    seed(w);
    const ledger = new FakeLedger(() => clock);
    await runAccountPurge(U, makeDeps(w, { ledger }));
    w.removeCalls = 0;
    const again = await runAccountPurge(U, makeDeps(w, { ledger }));
    expect(again.status).toBe('complete');
    expect(w.removeCalls).toBe(0);
    expect(again.counts.storage_deleted).toBeGreaterThanOrEqual(0);
    expect(w.authUsers.has(OTHER)).toBe(true);
  });

  it('user with zero recordings completes without touching providers', async () => {
    w.authUsers.add(U);
    const res = await runAccountPurge(U, makeDeps(w));
    expect(res.status).toBe('complete');
    expect(w.removeCalls).toBe(0);
    expect(w.events).not.toContain('recall.delete');
    expect(w.events).not.toContain('twilio.delete');
    expect(w.authUsers.has(U)).toBe(false);
  });

  it('bot-run media: terminal bots are not stopped, every bot gets delete-media', async () => {
    w.authUsers.add(U);
    w.botRuns = [{ user: U, recall_bot_id: 'a', status: 'completed' }, { user: U, recall_bot_id: 'b', status: 'failed' }, { user: U, recall_bot_id: 'c', status: 'pending' }];
    w.recallMedia = new Set(['a', 'b', 'c']);
    const res = await runAccountPurge(U, makeDeps(w));
    expect(res.status).toBe('complete');
    expect(w.stopped).toEqual(['c']);
    expect(w.recallMedia.size).toBe(0);
    expect(res.counts.recall_deleted).toBe(3);
  });

  it('concurrent calls for one user: one runs, the other reports in_progress, nothing is deleted twice', async () => {
    seed(w);
    const ledger = new FakeLedger(() => clock);
    const [a, b] = await Promise.all([runAccountPurge(U, makeDeps(w, { ledger })), runAccountPurge(U, makeDeps(w, { ledger }))]);
    expect([a.status, b.status].sort()).toEqual(['complete', 'in_progress']);
    expect(w.events.filter((e) => e === 'db.deleteAuth')).toHaveLength(1);
  });

  it('a lease held by another instance (ledger lock) yields in_progress and deletes nothing', async () => {
    seed(w);
    const ledger = new FakeLedger(() => clock);
    ledger.rows.set(hashUserRef(U), { userRef: hashUserRef(U), userId: U, status: 'running', pending: { storage: [], recall: [], twilio: [] }, counts: emptyCounts(), attempts: 0, lockedUntil: clock + 60_000 });
    const res = await runAccountPurge(U, makeDeps(w, { ledger }));
    expect(res.status).toBe('in_progress');
    expect(w.removeCalls).toBe(0);
    expect(w.authUsers.has(U)).toBe(true);
  });

  it('never deletes a path outside the user prefix, even if a DB row points there', async () => {
    seed(w);
    w.recordings.push({ id: 'evil1', user: U, file_path: `${OTHER}/o1.m4a` });
    w.recordings.push({ id: 'evil2', user: U, file_path: `${U}/../${OTHER}/o1.m4a` });
    w.recordings.push({ id: 'evil3', user: U, file_path: `/etc/passwd` });
    const res = await runAccountPurge(U, makeDeps(w));
    expect(w.has(AUDIO, `${OTHER}/o1.m4a`)).toBe(true);
    expect(res.counts.skipped_foreign_paths).toBe(3);
  });

  it('dry run reports counts and changes nothing', async () => {
    seed(w);
    const ledger = new FakeLedger(() => clock);
    const before = JSON.stringify([...w.storage.entries()].map(([k, v]) => [k, [...v]]));
    const res = await runAccountPurge(U, makeDeps(w, { ledger, dryRun: true }));
    expect(res.status).toBe('dry_run');
    expect(res.plan).toMatchObject({ storage_objects: 6, recall_bots: 2, twilio_recordings: 1 });
    expect(JSON.stringify([...w.storage.entries()].map(([k, v]) => [k, [...v]]))).toBe(before);
    expect(w.authUsers.has(U)).toBe(true);
    expect(w.recallMedia.size).toBe(3);
    expect(w.stopped).toEqual([]);
    expect(ledger.rows.size).toBe(0);
    expect(w.events).not.toContain('db.deleteRows');
  });

  it('ledger unavailable (migration not applied): external failure blocks local deletion so the user can retry', async () => {
    seed(w);
    const unavailable: PurgeLedger = {
      async acquire() { throw new LedgerUnavailableError('no table'); },
      async save() { throw new LedgerUnavailableError('no table'); },
      async listRetryable() { return []; },
      async countNeedsAttention() { return 0; },
    };
    w.recallFail.add('bot-done');
    const res = await runAccountPurge(U, makeDeps(w, { ledger: unavailable }));
    expect(res.status).toBe('blocked');
    expect(w.authUsers.has(U)).toBe(true);
    expect(w.events).not.toContain('db.deleteRows');
    // retry by the user once Recall is healthy completes everything
    w.recallFail.clear();
    const ok = await runAccountPurge(U, makeDeps(w, { ledger: unavailable }));
    expect(ok.status).toBe('complete');
    expect(w.authUsers.has(U)).toBe(false);
  });

  it('ledger null behaves like unavailable', async () => {
    seed(w);
    w.twilioFail.add('RE_u1');
    const res = await runAccountPurge(U, makeDeps(w, { ledger: null }));
    expect(res.status).toBe('blocked');
    expect(w.authUsers.has(U)).toBe(true);
  });

  it('plan save failing mid-run is treated as no durable ledger (does not delete rows on external failure)', async () => {
    seed(w);
    const ledger = new FakeLedger(() => clock);
    ledger.failFirstSave = true;
    w.recallFail.add('bot-done');
    const res = await runAccountPurge(U, makeDeps(w, { ledger }));
    expect(res.status).toBe('blocked');
    expect(w.authUsers.has(U)).toBe(true);
  });

  it('auth user deletion failure: status failed, 500-class result, retry completes', async () => {
    seed(w);
    w.authFailTimes = 1;
    const ledger = new FakeLedger(() => clock);
    const res = await runAccountPurge(U, makeDeps(w, { ledger }));
    expect(res.status).toBe('failed');
    expect(ledger.rows.get(hashUserRef(U))!.status).toBe('failed');
    clock += 24 * 3600_000;
    const retry = await retryPendingPurges(makeDeps(w, { ledger }));
    expect(retry.processed).toBe(1);
    expect(w.authUsers.has(U)).toBe(false);
    expect(ledger.rows.get(hashUserRef(U))!.status).toBe('complete');
  });

  it('gives up after MAX_PURGE_ATTEMPTS, marks needs_attention and alerts', async () => {
    seed(w);
    w.recallFail.add('bot-done');
    const ledger = new FakeLedger(() => clock);
    await runAccountPurge(U, makeDeps(w, { ledger }));
    for (let i = 0; i < MAX_PURGE_ATTEMPTS + 2; i++) {
      clock += 24 * 3600_000;
      await retryPendingPurges(makeDeps(w, { ledger }));
    }
    const row = ledger.rows.get(hashUserRef(U))!;
    expect(row.status).toBe('needs_attention');
    expect(w.alerts.some((a) => a.code === 'PURGE_NEEDS_ATTENTION')).toBe(true);
  });

  it('retry does not run before next_attempt_at (backoff)', async () => {
    seed(w);
    w.recallFail.add('bot-done');
    const ledger = new FakeLedger(() => clock);
    await runAccountPurge(U, makeDeps(w, { ledger }));
    const retry = await retryPendingPurges(makeDeps(w, { ledger })); // same instant
    expect(retry.processed).toBe(0);
  });

  it('Recall not configured while bots exist: stays pending (does not pretend it was deleted)', async () => {
    seed(w);
    const res = await runAccountPurge(U, makeDeps(w, { recallConfigured: false }));
    expect(res.status).toBe('pending_external');
    expect(res.pending.recall).toBe(2);
  });
});

describe('hashUserRef', () => {
  it('is a stable 64-char hex digest that does not contain the id', () => {
    expect(hashUserRef(U)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUserRef(U)).toBe(hashUserRef(U));
    expect(hashUserRef(U)).not.toContain(U);
  });
});
