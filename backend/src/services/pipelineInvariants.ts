/**
 * End-to-end invariants, checked every 30 minutes. These catch what no single catch block can: work that is silently
 * stuck, or a pipeline that produces nothing. Each breach raises ONE stable alert (re-sent at most every 6 hours);
 * context is counts only.
 *
 *   STUCK_RECORDINGS         recordings left in a mid-pipeline status for 3 h (the 65-day 'transcribing' incident)
 *   BOT_NEVER_JOINED         bot runs still pending/joining 45 min to 24 h after they were created. Older rows are not
 *                            alerted on: nothing can still change for them, and expireStaleBotRuns() closes them out
 *   COMPLETED_NO_SUMMARY     recordings completed in the last 24 h that have no summary row
 *   ZERO_SUCCESS_24H         recordings were created in the last 24 h and none completed
 *   HIGH_FAILURE_RATE_24H    at least 5 created and at least half failed
 */
import { supabaseAdmin } from '../lib/supabase.js';
import { reportAlert } from '../lib/alerts.js';
import { registerLoop, runLoopPass, reportLoopScanError } from '../lib/loopMonitor.js';

export const INVARIANT_INTERVAL_MS = 30 * 60_000;
const REALERT_MS = 6 * 3600_000;
const HOUR = 3600_000;
/** A bot run younger than this may legitimately still be joining (waiting room, early scheduling). */
export const BOT_JOIN_GRACE_MS = 45 * 60_000;
/** Past this age a pending/joining row is stale data (handled by expireStaleBotRuns), not a fresh failure. */
export const BOT_ALERT_MAX_AGE_MS = 24 * HOUR;

export interface InvariantResult { code: string; count: number }

export async function checkPipelineInvariants(now: number = Date.now()): Promise<InvariantResult[]> {
  const breaches: InvariantResult[] = [];
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const fire = (code: string, count: number, extra: Record<string, unknown> = {}) => {
    breaches.push({ code, count });
    reportAlert('pipeline_invariant', code, { count, ...extra }, REALERT_MS);
  };

  const stuck = await supabaseAdmin
    .from('recordings')
    .select('id', { count: 'exact', head: true })
    .in('status', ['uploaded', 'transcribing', 'transcribed', 'summarizing'])
    .lt('updated_at', iso(3 * HOUR));
  if (stuck.error) { reportLoopScanError('PipelineInvariants'); return breaches; }
  if ((stuck.count ?? 0) > 0) fire('STUCK_RECORDINGS', stuck.count ?? 0);

  const botStuck = await supabaseAdmin
    .from('bot_runs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'joining'])
    .lt('created_at', iso(BOT_JOIN_GRACE_MS))
    .gte('created_at', iso(BOT_ALERT_MAX_AGE_MS));
  if (!botStuck.error && (botStuck.count ?? 0) > 0) fire('BOT_NEVER_JOINED', botStuck.count ?? 0);

  const [created, completed, failed] = await Promise.all([
    supabaseAdmin.from('recordings').select('id', { count: 'exact', head: true }).gte('created_at', iso(24 * HOUR)).lt('created_at', iso(30 * 60_000)),
    supabaseAdmin.from('recordings').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('created_at', iso(24 * HOUR)).lt('created_at', iso(30 * 60_000)),
    supabaseAdmin.from('recordings').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', iso(24 * HOUR)).lt('created_at', iso(30 * 60_000)),
  ]);
  if (created.error || completed.error || failed.error) { reportLoopScanError('PipelineInvariants'); return breaches; }
  const n = created.count ?? 0;
  const c = completed.count ?? 0;
  const f = failed.count ?? 0;
  if (n >= 3 && c === 0) fire('ZERO_SUCCESS_24H', n, { created: n, completed: c, failed: f });
  else if (n >= 5 && f / n >= 0.5) fire('HIGH_FAILURE_RATE_24H', f, { created: n, completed: c, failed: f });

  // Completed recordings with no summary row (summary insert silently skipped, or deleted by a retry that never finished).
  const done = await supabaseAdmin
    .from('recordings')
    .select('id')
    .eq('status', 'completed')
    .gte('processed_at', iso(24 * HOUR))
    .lt('processed_at', iso(15 * 60_000))
    .limit(500);
  if (!done.error && done.data && done.data.length > 0) {
    const ids = done.data.map((r: { id: string }) => r.id);
    const sums = await supabaseAdmin.from('summaries').select('recording_id').in('recording_id', ids);
    if (!sums.error) {
      const have = new Set((sums.data ?? []).map((s: { recording_id: string }) => s.recording_id));
      const missing = ids.filter((id: string) => !have.has(id)).length;
      if (missing > 0) fire('COMPLETED_NO_SUMMARY', missing, { checked: ids.length });
    }
  }
  return breaches;
}

export function startPipelineInvariantLoop(): void {
  registerLoop('PipelineInvariants', INVARIANT_INTERVAL_MS);
  // First run after 5 minutes so a deploy restart does not alert on jobs it just interrupted.
  setTimeout(() => { void runLoopPass('PipelineInvariants', () => checkPipelineInvariants()); }, 5 * 60_000).unref?.();
  setInterval(() => { void runLoopPass('PipelineInvariants', () => checkPipelineInvariants()); }, INVARIANT_INTERVAL_MS);
}
