/**
 * Heartbeats and a watchdog for the background loops (BotJoinReconciler, StuckRecovery, BotRecordingReconciler,
 * OrphanRecovery). Before this, a pass that threw, or a loop that never started or hung, only wrote a console line.
 *
 *  - runLoopPass(name, fn): runs one pass, records a heartbeat on success, reports a thrown pass.
 *  - reportLoopScanError(name): for scan queries that return { error } instead of throwing (the pass "succeeds" but did nothing).
 *  - startLoopWatchdog(): every 5 minutes, any registered loop with no heartbeat for 3x its interval (min 10 min) raises
 *    one alert; a loop that never registered within 10 minutes of boot raises another.
 * This only catches a loop that stops while the process is alive; a dead process is caught by the reporter's /health probe.
 */
import { reportAlert } from './alerts.js';

interface LoopState { intervalMs: number; lastHeartbeat: number; lastError: number | null; registeredAt: number }

const loops = new Map<string, LoopState>();
const bootedAt = Date.now();
let watchdog: NodeJS.Timeout | null = null;

export const EXPECTED_LOOPS = ['BotJoinReconciler', 'StuckRecovery', 'BotRecordingReconciler', 'OrphanRecovery', 'PipelineInvariants'] as const;

export function registerLoop(name: string, intervalMs: number): void {
  const now = Date.now();
  if (!loops.has(name)) loops.set(name, { intervalMs, lastHeartbeat: now, lastError: null, registeredAt: now });
}

export function recordHeartbeat(name: string): void {
  const l = loops.get(name);
  if (l) l.lastHeartbeat = Date.now();
}

export async function runLoopPass(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    recordHeartbeat(name);
  } catch (e) {
    const l = loops.get(name);
    if (l) l.lastError = Date.now();
    console.error(`[LoopMonitor] ${name} pass threw:`, e instanceof Error ? e.message : e);
    reportAlert('background_loop_error', `${name.toUpperCase()}_PASS_THREW`, { loop: name });
  }
}

/** A scan whose database query failed: the pass returned normally but did nothing. Not a heartbeat. */
export function reportLoopScanError(name: string): void {
  const l = loops.get(name);
  if (l) l.lastError = Date.now();
  reportAlert('background_loop_error', `${name.toUpperCase()}_SCAN_FAILED`, { loop: name });
}

/** The loop's start-up import/init failed, so it will never run. */
export function reportLoopInitFailure(name: string): void {
  reportAlert('background_loop_error', `${name.toUpperCase()}_INIT_FAILED`, { loop: name });
}

export interface LoopStatus { name: string; minutesSinceHeartbeat: number | null; stale: boolean }

export function getLoopStatus(now: number = Date.now(), expected: readonly string[] = EXPECTED_LOOPS): LoopStatus[] {
  return expected.map((name) => {
    const l = loops.get(name);
    if (!l) {
      const bootMin = (now - bootedAt) / 60_000;
      return { name, minutesSinceHeartbeat: null, stale: bootMin > 10 };
    }
    const limit = Math.max(3 * l.intervalMs, 10 * 60_000);
    return { name, minutesSinceHeartbeat: Math.round((now - l.lastHeartbeat) / 60_000), stale: now - l.lastHeartbeat > limit };
  });
}

export function checkLoops(now: number = Date.now(), expected: readonly string[] = EXPECTED_LOOPS): LoopStatus[] {
  const status = getLoopStatus(now, expected);
  for (const s of status) {
    if (!s.stale) continue;
    reportAlert('background_loop_stalled', `${s.name.toUpperCase()}_STALLED`, {
      loop: s.name,
      minutes_since_heartbeat: s.minutesSinceHeartbeat ?? 'never_started',
    });
  }
  return status;
}

export function startLoopWatchdog(): void {
  if (watchdog) return;
  watchdog = setInterval(() => { try { checkLoops(); } catch { /* never throws */ } }, 5 * 60_000);
  watchdog.unref?.();
}

/** Test hook. */
export function resetLoopMonitor(): void {
  loops.clear();
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
}
