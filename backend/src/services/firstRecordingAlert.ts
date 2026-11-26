/**
 * Reports to the failure reporter when a user's FIRST recording fails or ends with no speech. Volumes are too small for the
 * rate-based checks to see this, and a first try that goes nowhere is how a new user is lost.
 *
 * One scan instead of a call at every failure site: failures are written by processing, the upload sweepers, the bot
 * webhooks and the recovery loops, and a scan sees all of them.
 *
 * Context holds only non-content values (code, source, client, length, size) plus the opaque account id. Clear test
 * accounts are skipped. Dedupe is per process: a restart inside the window can report one recording twice (the reporter
 * collapses repeats of the same message within its window).
 */
import { supabaseAdmin } from '../lib/supabase.js';
import { reportFailure } from '../lib/failureReporter.js';
import { registerLoop, runLoopPass, reportLoopScanError } from '../lib/loopMonitor.js';
import { NO_SPEECH_CODE } from './shortRecordingGuard.js';

const LOOP = 'FirstRecordingAlert';
export const FIRST_RECORDING_SCAN_INTERVAL_MS = 5 * 60_000;
/** Only rows that changed this recently are looked at (several intervals, so a slow or skipped pass loses nothing). */
export const CHANGED_WINDOW_MS = 30 * 60_000;
/** Older recordings are history: renaming an old failed one must not report it again. Covers the 24 h upload sweeper. */
export const MAX_RECORDING_AGE_MS = 72 * 3600_000;
/** Automated and our own test accounts: reserved test domain, Play pre-launch devices. */
const TEST_ACCOUNT_RE = /@example\.(com|org|net)$|cloudtestlabaccounts|\.[0-9]{5}@gmail\.com$/i;

interface Row {
  id: string;
  user_id: string;
  status: string;
  error_code: string | null;
  source: string | null;
  content_type: string | null;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  created_at: string;
}

const reported = new Set<string>();

/** Test hook. */
export function resetFirstRecordingAlert(): void {
  reported.clear();
}

/** The web recorder and web uploads of a browser recording send webm; everything else cannot be told apart. */
const clientOf = (contentType: string | null) => (/^audio\/webm/i.test(contentType ?? '') ? 'web_recorder' : 'other');

const safeCode = (code: string | null) => (code && /^[A-Za-z0-9_]{1,50}$/.test(code) ? code : 'UNKNOWN');

/** Returns how many first-recording failures were reported. */
export async function scanFirstRecordingFailures(now: number = Date.now()): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('recordings')
    .select('id, user_id, status, error_code, source, content_type, duration_seconds, file_size_bytes, created_at')
    .or(`status.eq.failed,error_code.eq.${NO_SPEECH_CODE}`)
    .gte('updated_at', new Date(now - CHANGED_WINDOW_MS).toISOString())
    .gte('created_at', new Date(now - MAX_RECORDING_AGE_MS).toISOString())
    .limit(100);
  if (error) {
    console.error('[FirstRecordingAlert] scan failed:', error.message);
    reportLoopScanError(LOOP);
    return 0;
  }
  let sent = 0;
  for (const r of (data ?? []) as Row[]) {
    if (reported.has(r.id)) continue;
    const earlier = await supabaseAdmin
      .from('recordings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', r.user_id)
      .lt('created_at', r.created_at);
    if (earlier.error) { reportLoopScanError(LOOP); continue; }
    if ((earlier.count ?? 0) > 0) { reported.add(r.id); continue; }

    // An unreadable account is reported anyway: a missed real user is worse than one extra email.
    const account = await supabaseAdmin.auth.admin.getUserById(r.user_id).catch(() => null);
    if (TEST_ACCOUNT_RE.test(account?.data?.user?.email ?? '')) {
      reported.add(r.id);
      console.log('[FirstRecordingAlert] skipped a test account');
      continue;
    }

    const code = safeCode(r.error_code);
    reportFailure('first_recording_failed', new Error(`First recording failed: ${code}`), {
      code,
      source: r.source || 'unknown',
      client: clientOf(r.content_type),
      seconds: r.duration_seconds ? String(Math.round(r.duration_seconds)) : 'unknown',
      size_bytes: r.file_size_bytes ? String(r.file_size_bytes) : 'unknown',
    }, r.user_id);
    reported.add(r.id);
    sent++;
  }
  if (reported.size > 5000) reported.clear();
  return sent;
}

export function startFirstRecordingAlertLoop(): void {
  registerLoop(LOOP, FIRST_RECORDING_SCAN_INTERVAL_MS);
  setTimeout(() => { void runLoopPass(LOOP, () => scanFirstRecordingFailures()); }, 60_000).unref?.();
  setInterval(() => { void runLoopPass(LOOP, () => scanFirstRecordingFailures()); }, FIRST_RECORDING_SCAN_INTERVAL_MS).unref?.();
}
