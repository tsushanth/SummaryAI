/**
 * Reports calendar sign-ins that were started and never came back. The callback reports every failure it sees, but the
 * worst ones never reach it: a redirect address that points at a dead host, a provider page that blocks the user
 * ("redirect_uri_mismatch", "Need admin approval") or a user who gives up there. Google Calendar was broken that way for
 * months with nothing reported.
 *
 * The sign: the callback removes its oauth_states row on every path, so a row that outlives its expiry never came back.
 * Rows are only read. Context holds the provider and the client plus the opaque account id. Clear test accounts are
 * skipped, and so is anyone who has connected that provider since. Dedupe is per process: a restart inside the window can
 * report one attempt twice.
 */
import { supabaseAdmin } from '../lib/supabase.js';
import { reportFailure } from '../lib/failureReporter.js';
import { registerLoop, runLoopPass, reportLoopScanError } from '../lib/loopMonitor.js';
import { parseOAuthState } from './googleCalendarService.js';
import { TEST_ACCOUNT_RE } from './firstRecordingAlert.js';

const LOOP = 'CalendarConnectAlert';
export const CALENDAR_SCAN_INTERVAL_MS = 5 * 60_000;
/** Wait this long past expiry, so a late return is the callback's to report (STATE_EXPIRED) and not counted twice. */
export const EXPIRY_GRACE_MS = 5 * 60_000;
/** Only attempts that expired this recently are looked at: old rows are never removed and are history. */
export const EXPIRED_WINDOW_MS = 60 * 60_000;

interface Row { id: string; user_id: string; provider: string; state: string }

const reported = new Set<string>();

/** Test hook. */
export function resetCalendarConnectAlert(): void {
  reported.clear();
}

/** Returns how many unfinished sign-ins were reported. */
export async function scanUnfinishedCalendarConnects(now: number = Date.now()): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('oauth_states')
    .select('id, user_id, provider, state')
    .lte('expires_at', new Date(now - EXPIRY_GRACE_MS).toISOString())
    .gte('expires_at', new Date(now - EXPIRY_GRACE_MS - EXPIRED_WINDOW_MS).toISOString())
    .limit(100);
  if (error) {
    console.error('[CalendarConnectAlert] scan failed:', error.message);
    reportLoopScanError(LOOP);
    return 0;
  }
  let sent = 0;
  for (const r of (data ?? []) as Row[]) {
    if (reported.has(r.id)) continue;
    const provider = r.provider === 'microsoft' ? 'microsoft' : 'google';
    const connected = await supabaseAdmin
      .from('calendar_connections')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', r.user_id)
      .eq('provider', provider);
    if (connected.error) { reportLoopScanError(LOOP); continue; }
    if ((connected.count ?? 0) > 0) { reported.add(r.id); continue; }

    // An unreadable account is reported anyway: a missed real user is worse than one extra email.
    const account = await supabaseAdmin.auth.admin.getUserById(r.user_id).catch(() => null);
    if (TEST_ACCOUNT_RE.test(account?.data?.user?.email ?? '')) {
      reported.add(r.id);
      console.log('[CalendarConnectAlert] skipped a test account');
      continue;
    }

    reportFailure(
      'calendar_connect_unfinished',
      new Error(`Calendar sign-in never came back: ${provider.toUpperCase()}`),
      { provider, client: parseOAuthState(r.state)?.client ?? 'unknown' },
      r.user_id,
    );
    reported.add(r.id);
    sent++;
  }
  if (reported.size > 5000) reported.clear();
  return sent;
}

export function startCalendarConnectAlertLoop(): void {
  registerLoop(LOOP, CALENDAR_SCAN_INTERVAL_MS);
  setTimeout(() => { void runLoopPass(LOOP, () => scanUnfinishedCalendarConnects()); }, 90_000).unref?.();
  setInterval(() => { void runLoopPass(LOOP, () => scanUnfinishedCalendarConnects()); }, CALENDAR_SCAN_INTERVAL_MS).unref?.();
}
