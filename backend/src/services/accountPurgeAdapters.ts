/**
 * Production wiring for accountPurge.ts: Supabase (rows, storage, auth, ledger), Recall.ai, Twilio, alerts.
 * Kept separate so the purge logic itself imports nothing environment-bound and is tested with fakes.
 */
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { reportAlert } from '../lib/alerts.js';
import { registerLoop, runLoopPass } from '../lib/loopMonitor.js';
import { RecallService } from './recallService.js';
import { TwilioService } from './twilioService.js';
import {
  LedgerUnavailableError,
  MAX_PURGE_ATTEMPTS,
  retryPendingPurges,
  type LedgerRow,
  type PendingWork,
  type PurgeCounts,
  type PurgeDeps,
  type PurgeLedger,
  type PurgeStatus,
} from './accountPurge.js';

const PAGE = 1000;
const LEDGER_TABLE = 'account_purges';
const RETRY_INTERVAL_MS = 10 * 60_000;

/**
 * Tables deleted explicitly, children first. Most also cascade from auth.users, but listing them keeps the purge
 * correct if a live FK differs from the migrations and gives per-purge counts. A table that does not exist in the
 * live schema is skipped silently. Every delete is scoped by the user's own id column.
 */
export const USER_TABLES: { table: string; col: string }[] = [
  { table: 'qa_history', col: 'user_id' },
  { table: 'recording_shares', col: 'user_id' },
  { table: 'summary_email_sends', col: 'user_id' },
  { table: 'todos', col: 'user_id' },
  { table: 'live_transcripts', col: 'user_id' },
  { table: 'live_insights', col: 'user_id' },
  { table: 'bot_runs', col: 'user_id' },
  { table: 'phone_calls', col: 'user_id' },
  { table: 'verified_phones', col: 'user_id' },
  { table: 'recordings', col: 'user_id' },
  { table: 'meetings', col: 'user_id' },
  { table: 'calendar_connections', col: 'user_id' },
  { table: 'scheduled_bots', col: 'user_id' },
  { table: 'user_integrations', col: 'user_id' },
  { table: 'folders', col: 'user_id' },
  // First-party activation funnel. activation_events.user_id is NOT a foreign key, so it must be deleted explicitly.
  { table: 'activation_events', col: 'user_id' },
  { table: 'signup_attribution', col: 'user_id' },
  { table: 'profiles', col: 'id' },
];

interface DbError { code?: string; message?: string; status?: number }

function isMissingTable(e: DbError | null | undefined): boolean {
  if (!e) return false;
  return e.code === '42P01' || e.code === 'PGRST205' || /schema cache|does not exist/i.test(e.message ?? '');
}

async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return out;
      throw new Error(`purge collect failed: ${error.code ?? 'db'}`);
    }
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** Recursively lists every object under `${prefix}/`. Folder entries come back with id === null. */
async function listPrefix(bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 6) return [];
  const out: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      // A bucket that does not exist has nothing of the user's in it.
      if (/not found|does not exist/i.test(error.message ?? '')) return out;
      throw new Error(`storage list failed: ${bucket}`);
    }
    for (const item of data ?? []) {
      const full = `${prefix}/${item.name}`;
      if (item.id === null || item.id === undefined) out.push(...(await listPrefix(bucket, full, depth + 1)));
      else out.push(full);
    }
    if (!data || data.length < 100) return out;
  }
}

class SupabaseLedger implements PurgeLedger {
  constructor(private leaseMs = 5 * 60_000) {}

  private fail(error: DbError): never {
    if (isMissingTable(error)) throw new LedgerUnavailableError('account_purges table missing');
    throw new Error(`ledger error: ${error.code ?? 'db'}`);
  }

  private map(r: Record<string, unknown>): LedgerRow {
    return {
      userRef: String(r.user_ref),
      userId: (r.user_id as string | null) ?? null,
      status: r.status as PurgeStatus,
      pending: { storage: [], recall: [], twilio: [], ...((r.pending as Partial<PendingWork>) ?? {}) },
      counts: { recordings: 0, storage_deleted: 0, recall_deleted: 0, twilio_deleted: 0, rows_deleted: 0, skipped_foreign_paths: 0, ...((r.counts as Partial<PurgeCounts>) ?? {}) },
      attempts: Number(r.attempts ?? 0),
      nextAttemptAt: r.next_attempt_at ? Date.parse(String(r.next_attempt_at)) : null,
      lastErrorClass: (r.last_error_class as string | null) ?? null,
    };
  }

  async acquire(userRef: string, userId: string, leaseMs: number) {
    const now = Date.now();
    const lockedUntil = new Date(now + leaseMs).toISOString();
    const { data: existing, error } = await supabaseAdmin.from(LEDGER_TABLE).select('*').eq('user_ref', userRef).maybeSingle();
    if (error) this.fail(error);

    if (!existing) {
      const { error: insErr } = await supabaseAdmin.from(LEDGER_TABLE).insert({ user_ref: userRef, user_id: userId, status: 'running', locked_until: lockedUntil });
      if (insErr) {
        if (insErr.code === '23505') return { acquired: false as const }; // another instance inserted first
        this.fail(insErr);
      }
      return { acquired: true as const, row: this.map({ user_ref: userRef, user_id: userId, status: 'running' }) };
    }

    // Atomic compare-and-set: only succeeds if nobody holds an unexpired lease.
    const { data: won, error: updErr } = await supabaseAdmin
      .from(LEDGER_TABLE)
      .update({ status: 'running', user_id: userId, locked_until: lockedUntil, updated_at: new Date(now).toISOString() })
      .eq('user_ref', userRef)
      .or(`locked_until.is.null,locked_until.lt.${new Date(now).toISOString()}`)
      .select('user_ref');
    if (updErr) this.fail(updErr);
    if (!won || won.length === 0) return { acquired: false as const };
    return { acquired: true as const, row: this.map(existing) };
  }

  async save(userRef: string, patch: Partial<LedgerRow>): Promise<void> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) {
      row.status = patch.status;
      row.locked_until = patch.status === 'running' ? new Date(Date.now() + this.leaseMs).toISOString() : null;
      if (patch.status === 'complete') row.completed_at = new Date().toISOString();
    }
    if ('userId' in patch) row.user_id = patch.userId;
    if (patch.pending !== undefined) row.pending = patch.pending;
    if (patch.counts !== undefined) row.counts = patch.counts;
    if (patch.attempts !== undefined) row.attempts = patch.attempts;
    if ('nextAttemptAt' in patch) row.next_attempt_at = patch.nextAttemptAt ? new Date(patch.nextAttemptAt).toISOString() : null;
    if ('lastErrorClass' in patch) row.last_error_class = patch.lastErrorClass ?? null;
    const { error } = await supabaseAdmin.from(LEDGER_TABLE).update(row).eq('user_ref', userRef);
    if (error) this.fail(error);
  }

  async listRetryable(limit: number) {
    const { data, error } = await supabaseAdmin
      .from(LEDGER_TABLE)
      .select('user_id, status, attempts, next_attempt_at, locked_until')
      .in('status', ['pending_external', 'failed', 'running'])
      .not('user_id', 'is', null)
      .lt('attempts', MAX_PURGE_ATTEMPTS)
      .order('updated_at', { ascending: true })
      .limit(limit * 5);
    if (error) this.fail(error);
    const now = Date.now();
    return (data ?? [])
      .filter((r) => (!r.next_attempt_at || Date.parse(r.next_attempt_at) <= now) && (!r.locked_until || Date.parse(r.locked_until) <= now))
      .slice(0, limit)
      .map((r) => ({ userId: r.user_id as string }));
  }

  async countNeedsAttention() {
    const { count, error } = await supabaseAdmin.from(LEDGER_TABLE).select('user_ref', { count: 'exact', head: true }).eq('status', 'needs_attention');
    if (error) this.fail(error);
    return count ?? 0;
  }
}

export function createPurgeDeps(overrides: Partial<PurgeDeps> = {}): PurgeDeps {
  return {
    buckets: [config.STORAGE_BUCKET_AUDIO, config.STORAGE_BUCKET_EXPORTS],
    dryRun: config.ACCOUNT_PURGE_DRY_RUN === true,
    now: () => Date.now(),
    db: {
      async collect(userId) {
        const recordings = await selectAll<{ id: string; file_path: string | null }>((a, b) =>
          supabaseAdmin.from('recordings').select('id, file_path').eq('user_id', userId).order('id').range(a, b));
        const botRuns = await selectAll<{ recall_bot_id: string; status: string }>((a, b) =>
          supabaseAdmin.from('bot_runs').select('recall_bot_id, status').eq('user_id', userId).order('id').range(a, b));
        const calls = await selectAll<{ recording_sid: string | null }>((a, b) =>
          supabaseAdmin.from('phone_calls').select('recording_sid').eq('user_id', userId).not('recording_sid', 'is', null).order('id').range(a, b));
        return { recordings, botRuns, twilioSids: calls.map((c) => c.recording_sid).filter((s): s is string => !!s) };
      },
      async countRows(userId) {
        const out: Record<string, number> = {};
        for (const { table, col } of USER_TABLES) {
          const { count, error } = await supabaseAdmin.from(table).select(col, { count: 'exact', head: true }).eq(col, userId);
          if (!error) out[table] = count ?? 0;
        }
        return out;
      },
      async deleteRows(userId) {
        let deleted = 0;
        const failedTables: string[] = [];
        for (const { table, col } of USER_TABLES) {
          const { count, error } = await supabaseAdmin.from(table).delete({ count: 'exact' }).eq(col, userId);
          if (error) {
            if (!isMissingTable(error)) failedTables.push(table);
            continue;
          }
          deleted += count ?? 0;
        }
        return { deleted, failedTables };
      },
      async deleteAuthUser(userId) {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (!error) return 'deleted';
        const e = error as unknown as DbError;
        if (e.status === 404 || /not found/i.test(e.message ?? '')) return 'not_found';
        throw new Error('auth delete failed');
      },
    },
    storage: {
      listPrefix,
      async remove(bucket, paths) {
        const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
        if (error) throw new Error(`storage remove failed: ${bucket}`);
      },
    },
    recall: {
      isConfigured: () => !!config.RECALL_API_KEY,
      stopBot: (id) => RecallService.stopBot(id),
      deleteMedia: (id) => RecallService.deleteBotMedia(id),
    },
    twilio: {
      isConfigured: () => !!(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN),
      async deleteRecording(sid) {
        try {
          await TwilioService.deleteRecording(sid);
          return 'deleted';
        } catch (err) {
          const e = err as { status?: number; code?: number };
          if (e?.status === 404 || e?.code === 20404) return 'not_found';
          throw err;
        }
      },
    },
    ledger: new SupabaseLedger(),
    alert: (code, context) => { reportAlert('account_purge', code, context ?? {}); },
    ...overrides,
  };
}

/** Background retry of unfinished purges. Quiet when the ledger migration has not been applied. */
export function startAccountPurgeRetryLoop(): void {
  const pass = async () => {
    try {
      await retryPendingPurges(createPurgeDeps());
    } catch (e) {
      if (e instanceof LedgerUnavailableError) return;
      throw e;
    }
  };
  registerLoop('AccountPurgeRetry', RETRY_INTERVAL_MS);
  setTimeout(() => void runLoopPass('AccountPurgeRetry', pass), 60_000);
  setInterval(() => void runLoopPass('AccountPurgeRetry', pass), RETRY_INTERVAL_MS);
  console.log('[AccountPurge] retry loop started');
}
