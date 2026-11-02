/**
 * Account purge: the ordered, idempotent, resumable deletion behind DELETE /api/users/account.
 *
 * Why this exists: deleting only database rows left the user's audio in Supabase Storage and left meeting media at
 * Recall.ai (and, until the post-download delete runs, call recordings at Twilio), while the privacy policy promises
 * deletion. See docs/legal/privacy-policy-draft-2026-11.md.
 *
 * Order (never reordered):
 *   1. lock the user (in-process Set + ledger lease for other Fly machines)
 *   2. COLLECT everything that lives outside our rows: storage object paths (recording rows AND a prefix sweep of every
 *      bucket), Recall bot ids, Twilio recording SIDs. Persist that plan to the ledger BEFORE deleting anything, so a
 *      crash after the rows are gone can still finish the external deletes.
 *   3. delete storage objects (batched), then verify the user prefix is empty
 *   4. Recall: stop live bots, then delete bot media
 *   5. Twilio: delete any recording we still hold a SID for
 *   6. delete database rows, then the auth user LAST
 *   7. ledger -> complete (user id cleared; only counts remain) or pending_external (retry loop finishes it)
 *
 * Failure policy: with a durable ledger, a failing external step never blocks local deletion; it stays in the ledger's
 * pending list, is retried with backoff, and raises an alert (counts/classes only). WITHOUT a durable ledger (the
 * migration is not applied yet, or the ledger is down) we fail closed: any external failure stops the purge before rows
 * are deleted, so the account still exists and the user can simply retry.
 *
 * Privacy of the purge itself: the ledger and every alert carry counts and stable codes only, never recording titles,
 * transcripts, emails, or (after completion) the user id.
 *
 * This module has no imports from supabase/config so it is unit-testable with fakes; production wiring is in
 * accountPurgeAdapters.ts.
 */
import { createHash } from 'node:crypto';

export const MAX_PURGE_ATTEMPTS = 10;
const LEASE_MS = 5 * 60_000;
const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 6 * 3600_000;
const PHASE_ABORT_AFTER_CONSECUTIVE_FAILURES = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PurgeStatus = 'running' | 'pending_external' | 'failed' | 'needs_attention' | 'complete';

export interface StorageRef { bucket: string; path: string }
export interface RecallItem { botId: string; stop: boolean }
export interface PendingWork { storage: StorageRef[]; recall: RecallItem[]; twilio: string[] }

export interface PurgeCounts {
  recordings: number;
  storage_deleted: number;
  recall_deleted: number;
  twilio_deleted: number;
  rows_deleted: number;
  skipped_foreign_paths: number;
}

export interface LedgerRow {
  userRef: string;
  userId: string | null;
  status: PurgeStatus;
  pending: PendingWork;
  counts: PurgeCounts;
  attempts: number;
  nextAttemptAt?: number | null;
  lastErrorClass?: string | null;
}

export class LedgerUnavailableError extends Error {}

export interface PurgeLedger {
  /** Take the per-user lease. acquired=false means another run holds it. Throws LedgerUnavailableError if no durable store. */
  acquire(userRef: string, userId: string, leaseMs: number): Promise<{ acquired: false } | { acquired: true; row: LedgerRow }>;
  save(userRef: string, patch: Partial<LedgerRow>): Promise<void>;
  /** Users whose purge is unfinished and due for a retry (lease expired, backoff elapsed, attempts left). */
  listRetryable(limit: number): Promise<{ userId: string }[]>;
  countNeedsAttention(): Promise<number>;
}

export interface PurgeDeps {
  buckets: string[];
  dryRun: boolean;
  removeBatchSize?: number;
  now(): number;
  db: {
    collect(userId: string): Promise<{
      recordings: { id: string; file_path: string | null }[];
      botRuns: { recall_bot_id: string; status: string }[];
      twilioSids: string[];
    }>;
    countRows(userId: string): Promise<Record<string, number>>;
    deleteRows(userId: string): Promise<{ deleted: number; failedTables: string[] }>;
    /** 'not_found' (already gone) is success. Throws on a real failure. */
    deleteAuthUser(userId: string): Promise<'deleted' | 'not_found'>;
  };
  storage: {
    /** Every object path under `${prefix}/` (recursive, paginated), as full paths. */
    listPrefix(bucket: string, prefix: string): Promise<string[]>;
    /** Missing objects are not an error. Throws on failure. */
    remove(bucket: string, paths: string[]): Promise<void>;
  };
  recall: {
    isConfigured(): boolean;
    /** Best-effort: cancel a scheduled bot / make a live bot leave. Must not throw for "already finished". */
    stopBot(botId: string): Promise<void>;
    /** 'in_progress' = Recall is still deleting or the bot is not finished; stays pending. Throws on failure. */
    deleteMedia(botId: string): Promise<'deleted' | 'not_found' | 'in_progress'>;
  };
  twilio: {
    isConfigured(): boolean;
    deleteRecording(sid: string): Promise<'deleted' | 'not_found'>;
  };
  ledger: PurgeLedger | null;
  /** Stable code + non-content context only. */
  alert(code: string, context?: Record<string, unknown>): void;
}

export interface PurgeResult {
  status: 'complete' | 'pending_external' | 'in_progress' | 'dry_run' | 'blocked' | 'failed';
  counts: PurgeCounts;
  pending: { storage: number; recall: number; twilio: number };
  plan?: { storage_objects: number; recall_bots: number; twilio_recordings: number; rows: Record<string, number> };
}

export function hashUserRef(userId: string): string {
  return createHash('sha256').update(`meetingmind-account-purge:${userId}`).digest('hex');
}

const emptyCounts = (): PurgeCounts => ({ recordings: 0, storage_deleted: 0, recall_deleted: 0, twilio_deleted: 0, rows_deleted: 0, skipped_foreign_paths: 0 });
const emptyPending = (): PendingWork => ({ storage: [], recall: [], twilio: [] });
const pendingCounts = (p: PendingWork) => ({ storage: p.storage.length, recall: p.recall.length, twilio: p.twilio.length });
const isEmpty = (p: PendingWork) => p.storage.length + p.recall.length + p.twilio.length === 0;
const TERMINAL_BOT = new Set(['completed', 'failed', 'cancelled']);

/** A storage path is only ours to delete if it sits directly under `${userId}/` and cannot traverse out of it. */
export function isOwnedPath(userId: string, path: string): boolean {
  if (!UUID_RE.test(userId)) return false;
  if (!path.startsWith(`${userId}/`)) return false;
  if (path.length <= userId.length + 1) return false;
  return !path.split('/').some((seg) => seg === '..' || seg === '.');
}

const inFlight = new Set<string>();

export async function runAccountPurge(userId: string, deps: PurgeDeps): Promise<PurgeResult> {
  const baseCounts = emptyCounts();
  if (!UUID_RE.test(userId)) return { status: 'failed', counts: baseCounts, pending: { storage: 0, recall: 0, twilio: 0 } };

  if (inFlight.has(userId)) return { status: 'in_progress', counts: baseCounts, pending: { storage: 0, recall: 0, twilio: 0 } };
  inFlight.add(userId);
  try {
    return await purgeLocked(userId, deps);
  } finally {
    inFlight.delete(userId);
  }
}

async function purgeLocked(userId: string, deps: PurgeDeps): Promise<PurgeResult> {
  const userRef = hashUserRef(userId);

  // ---- dry run: plan only, no lock, no ledger, nothing mutated
  if (deps.dryRun) {
    const plan = await collectPlan(userId, deps);
    return {
      status: 'dry_run',
      counts: { ...emptyCounts(), recordings: plan.recordings, skipped_foreign_paths: plan.skipped },
      pending: pendingCounts(plan.work),
      plan: {
        storage_objects: plan.work.storage.length,
        recall_bots: plan.work.recall.length,
        twilio_recordings: plan.work.twilio.length,
        rows: await deps.db.countRows(userId),
      },
    };
  }

  // ---- lease (cross-instance). No durable ledger => volatile mode (fail closed on external failures).
  let durable = false;
  let prior: LedgerRow | null = null;
  if (deps.ledger) {
    try {
      const got = await deps.ledger.acquire(userRef, userId, LEASE_MS);
      if (!got.acquired) return { status: 'in_progress', counts: emptyCounts(), pending: { storage: 0, recall: 0, twilio: 0 } };
      prior = got.row;
      durable = true;
    } catch (e) {
      deps.alert('PURGE_LEDGER_UNAVAILABLE', { kind: e instanceof LedgerUnavailableError ? 'missing' : 'error' });
    }
  }

  const counts: PurgeCounts = { ...emptyCounts(), ...(prior?.counts ?? {}) };
  const attempts = prior?.attempts ?? 0;

  // ---- 1. collect, then persist the plan before any destructive call
  const plan = await collectPlan(userId, deps);
  counts.recordings += plan.recordings;
  counts.skipped_foreign_paths += plan.skipped;
  const work = mergePending(prior?.pending ?? emptyPending(), plan.work);

  const save = async (patch: Partial<LedgerRow>): Promise<void> => {
    if (!deps.ledger || !durable) return;
    await deps.ledger.save(userRef, patch);
  };
  if (durable) {
    try {
      await deps.ledger!.save(userRef, { status: 'running', pending: work, counts });
    } catch {
      durable = false; // cannot prove the plan survives a crash => do not rely on the ledger
      deps.alert('PURGE_LEDGER_UNAVAILABLE', { kind: 'save_failed' });
    }
  }
  const checkpoint = () => save({ status: 'running', pending: work, counts }).catch(() => undefined);

  // ---- 2. storage, 3. Recall, 4. Twilio
  await phaseStorage(userId, work, counts, deps, checkpoint);
  await phaseRecall(work, counts, deps, checkpoint);
  await phaseTwilio(work, counts, deps, checkpoint);

  // ---- gate: without a durable ledger an external failure must not be followed by row deletion
  if (!isEmpty(work) && !durable) {
    return { status: 'blocked', counts, pending: pendingCounts(work) };
  }

  // ---- 5. rows, then the auth user last
  try {
    const rows = await deps.db.deleteRows(userId);
    counts.rows_deleted += rows.deleted;
    if (rows.failedTables.length > 0) deps.alert('PURGE_ROW_DELETE_PARTIAL', { tables: rows.failedTables.length });
  } catch {
    deps.alert('PURGE_ROW_DELETE_FAILED');
  }

  let authOk = true;
  try {
    await deps.db.deleteAuthUser(userId);
  } catch {
    authOk = false;
    deps.alert('PURGE_AUTH_DELETE_FAILED');
  }

  if (authOk && isEmpty(work)) {
    await save({ status: 'complete', userId: null, pending: emptyPending(), counts, attempts, nextAttemptAt: null, lastErrorClass: null }).catch(() => undefined);
    return { status: 'complete', counts, pending: pendingCounts(work) };
  }

  const nextAttempts = attempts + 1;
  const giveUp = nextAttempts >= MAX_PURGE_ATTEMPTS;
  const status: PurgeStatus = giveUp ? 'needs_attention' : authOk ? 'pending_external' : 'failed';
  if (giveUp) deps.alert('PURGE_NEEDS_ATTENTION', { attempts: nextAttempts, ...pendingCounts(work) });
  await save({
    status,
    userId, // kept until complete: the retry loop needs it
    pending: work,
    counts,
    attempts: nextAttempts,
    nextAttemptAt: deps.now() + Math.min(RETRY_BASE_MS * 2 ** (nextAttempts - 1), RETRY_MAX_MS),
    lastErrorClass: authOk ? 'EXTERNAL' : 'AUTH_DELETE',
  }).catch(() => undefined);

  return { status: authOk ? 'pending_external' : 'failed', counts, pending: pendingCounts(work) };
}

// ------------------------------------------------------------------ collection

async function collectPlan(userId: string, deps: PurgeDeps): Promise<{ work: PendingWork; recordings: number; skipped: number }> {
  const found = await deps.db.collect(userId);
  const storage = new Map<string, StorageRef>();
  let skipped = 0;
  const add = (bucket: string, path: string) => storage.set(`${bucket}\u0000${path}`, { bucket, path });

  // Recording rows (uploads, in-person, PDFs, bot media, phone-call audio) all keep their object in the audio bucket.
  for (const r of found.recordings) {
    if (!r.file_path) continue;
    if (isOwnedPath(userId, r.file_path)) add(deps.buckets[0], r.file_path);
    else skipped++;
  }
  // Prefix sweep: anything under `${userId}/` in any bucket, including objects whose row is already gone.
  for (const bucket of deps.buckets) {
    for (const p of await deps.storage.listPrefix(bucket, userId)) {
      if (isOwnedPath(userId, p)) add(bucket, p);
      else skipped++;
    }
  }

  const recall = new Map<string, RecallItem>();
  for (const b of found.botRuns) {
    if (!b.recall_bot_id) continue;
    const stop = !TERMINAL_BOT.has(b.status);
    const prev = recall.get(b.recall_bot_id);
    recall.set(b.recall_bot_id, { botId: b.recall_bot_id, stop: stop || !!prev?.stop });
  }

  return {
    work: { storage: [...storage.values()], recall: [...recall.values()], twilio: [...new Set(found.twilioSids.filter(Boolean))] },
    recordings: found.recordings.length,
    skipped,
  };
}

function mergePending(a: PendingWork, b: PendingWork): PendingWork {
  const storage = new Map<string, StorageRef>();
  for (const s of [...a.storage, ...b.storage]) storage.set(`${s.bucket}\u0000${s.path}`, s);
  const recall = new Map<string, RecallItem>();
  for (const r of [...a.recall, ...b.recall]) recall.set(r.botId, { botId: r.botId, stop: r.stop || !!recall.get(r.botId)?.stop });
  return { storage: [...storage.values()], recall: [...recall.values()], twilio: [...new Set([...a.twilio, ...b.twilio])] };
}

// ------------------------------------------------------------------ phases (each mutates `work` in place)

async function phaseStorage(userId: string, work: PendingWork, counts: PurgeCounts, deps: PurgeDeps, checkpoint: () => Promise<void>): Promise<void> {
  const batch = deps.removeBatchSize ?? 100;
  const byBucket = new Map<string, string[]>();
  for (const s of work.storage) byBucket.set(s.bucket, [...(byBucket.get(s.bucket) ?? []), s.path]);

  let failed = false;
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length && !failed; i += batch) {
      const chunk = paths.slice(i, i + batch);
      try {
        await deps.storage.remove(bucket, chunk);
        const gone = new Set(chunk);
        work.storage = work.storage.filter((s) => !(s.bucket === bucket && gone.has(s.path)));
        counts.storage_deleted += chunk.length;
        await checkpoint();
      } catch {
        failed = true;
        deps.alert('STORAGE_DELETE_FAILED', { remaining: work.storage.length });
      }
    }
  }
  if (failed) return;

  // Verification: the user prefix must now be empty. Anything left (late upload, eventual consistency) stays pending.
  try {
    for (const bucket of deps.buckets) {
      const left = (await deps.storage.listPrefix(bucket, userId)).filter((p) => isOwnedPath(userId, p));
      for (const p of left) {
        if (!work.storage.some((s) => s.bucket === bucket && s.path === p)) work.storage.push({ bucket, path: p });
      }
      if (left.length > 0) deps.alert('STORAGE_RESIDUAL_AFTER_DELETE', { remaining: left.length });
    }
  } catch {
    deps.alert('STORAGE_VERIFY_FAILED');
  }
  await checkpoint();
}

async function phaseRecall(work: PendingWork, counts: PurgeCounts, deps: PurgeDeps, checkpoint: () => Promise<void>): Promise<void> {
  if (work.recall.length === 0) return;
  if (!deps.recall.isConfigured()) {
    deps.alert('RECALL_DELETE_FAILED', { class: 'NOT_CONFIGURED', remaining: work.recall.length });
    return;
  }
  let consecutive = 0;
  for (const item of [...work.recall]) {
    try {
      if (item.stop) await deps.recall.stopBot(item.botId).catch(() => undefined);
      const r = await deps.recall.deleteMedia(item.botId);
      if (r === 'in_progress') { consecutive = 0; continue; }
      work.recall = work.recall.filter((x) => x.botId !== item.botId);
      if (r === 'deleted') counts.recall_deleted++;
      consecutive = 0;
      await checkpoint();
    } catch {
      if (++consecutive >= PHASE_ABORT_AFTER_CONSECUTIVE_FAILURES) break;
    }
  }
  if (work.recall.length > 0) deps.alert('RECALL_DELETE_FAILED', { remaining: work.recall.length });
}

async function phaseTwilio(work: PendingWork, counts: PurgeCounts, deps: PurgeDeps, checkpoint: () => Promise<void>): Promise<void> {
  if (work.twilio.length === 0) return;
  if (!deps.twilio.isConfigured()) {
    deps.alert('TWILIO_DELETE_FAILED', { class: 'NOT_CONFIGURED', remaining: work.twilio.length });
    return;
  }
  let consecutive = 0;
  for (const sid of [...work.twilio]) {
    try {
      const r = await deps.twilio.deleteRecording(sid);
      work.twilio = work.twilio.filter((x) => x !== sid);
      if (r === 'deleted') counts.twilio_deleted++;
      consecutive = 0;
      await checkpoint();
    } catch {
      if (++consecutive >= PHASE_ABORT_AFTER_CONSECUTIVE_FAILURES) break;
    }
  }
  if (work.twilio.length > 0) deps.alert('TWILIO_DELETE_FAILED', { remaining: work.twilio.length });
}

// ------------------------------------------------------------------ retry loop body

/** One pass of the background retry: finishes purges that were left pending_external / failed / abandoned mid-run. */
export async function retryPendingPurges(deps: PurgeDeps, limit = 10): Promise<{ processed: number }> {
  if (!deps.ledger || deps.dryRun) return { processed: 0 };
  const due = await deps.ledger.listRetryable(limit);
  let processed = 0;
  for (const { userId } of due) {
    await runAccountPurge(userId, deps);
    processed++;
  }
  const stuck = await deps.ledger.countNeedsAttention().catch(() => 0);
  if (stuck > 0) deps.alert('PURGE_NEEDS_ATTENTION', { stuck });
  return { processed };
}
