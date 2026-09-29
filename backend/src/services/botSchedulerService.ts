/**
 * Bot Scheduler Service
 *
 * Schedules bot joins with an in-process setTimeout for low latency, backed
 * by a `bot_scheduler_jobs` row as the durable source of truth. The Fly.io
 * machine this runs on can restart between a scheduling call and the join
 * time (deploys, crashes), which would silently drop an in-memory timer —
 * so `startBotJoinReconcilerLoop` (called from index.ts) periodically claims
 * any `scheduled` job whose time has passed and triggers it, the same way
 * the other reconcilers in stuckMeetingRecovery.ts backstop missed webhooks.
 *
 * This used to dispatch through Google Cloud Tasks when GCP_PROJECT_ID was
 * set (Cloud Run deployment). That path was removed when the backend moved
 * to Fly.io — Fly keeps at least one machine running continuously
 * (fly.toml min_machines_running=1), so there's no scale-to-zero reason to
 * need an external scheduler, and the leftover GCP project this pointed at
 * had billing disabled, which made every auto-record toggle silently fail.
 */

import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';

// Track in-memory timers so we can cancel/replace them; the DB row is what
// actually survives a restart.
const scheduledTimers: Map<string, NodeJS.Timeout> = new Map();

/**
 * Schedule a bot to join a meeting
 */
export async function scheduleBotJoin(
  meetingId: string,
  userId: string,
  scheduledStart: string,
  offsetMinutes: number = 1
): Promise<string> {
  // Calculate join time (meeting start minus offset)
  const startTime = new Date(scheduledStart);
  const joinTime = new Date(startTime.getTime() - offsetMinutes * 60 * 1000);
  const now = new Date();

  // Don't schedule if join time is in the past (join immediately instead)
  if (joinTime <= now) {
    console.log(`[Scheduler] Join time is in the past, triggering immediately`);
    // Trigger immediately but asynchronously
    setImmediate(() => triggerBotJoin(meetingId, userId));
    return 'immediate';
  }

  const delayMs = joinTime.getTime() - now.getTime();

  console.log(
    `[Scheduler] Scheduling bot for meeting ${meetingId} at ${joinTime.toISOString()} (in ${Math.round(delayMs / 1000 / 60)} minutes)`
  );

  return scheduleWithTimeout(meetingId, userId, delayMs);
}

/**
 * Schedule using setTimeout, with a `bot_scheduler_jobs` row as the durable
 * fallback in case this process restarts before the timer fires.
 */
async function scheduleWithTimeout(
  meetingId: string,
  userId: string,
  delayMs: number
): Promise<string> {
  // Cancel any existing timer for this meeting
  const existingTimer = scheduledTimers.get(meetingId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    scheduledTimers.delete(meetingId);
  }

  const timer = setTimeout(() => {
    scheduledTimers.delete(meetingId);
    triggerBotJoin(meetingId, userId);
  }, delayMs);

  scheduledTimers.set(meetingId, timer);

  // Store job reference
  const jobId = `timeout-${meetingId}-${Date.now()}`;
  await supabaseAdmin.from('bot_scheduler_jobs').insert({
    meeting_id: meetingId,
    cloud_task_name: jobId,
    scheduled_for: new Date(Date.now() + delayMs).toISOString(),
    status: 'scheduled',
  });

  console.log(`[Scheduler] Created setTimeout for meeting ${meetingId}`);
  return jobId;
}

/**
 * Cancel a scheduled bot join
 */
export async function cancelScheduledBot(meetingId: string): Promise<void> {
  // Cancel in-memory timer if exists
  const timer = scheduledTimers.get(meetingId);
  if (timer) {
    clearTimeout(timer);
    scheduledTimers.delete(meetingId);
    console.log(`[Scheduler] Cancelled in-memory timer for meeting ${meetingId}`);
  }

  // Get scheduled task
  const { data: jobs } = await supabaseAdmin
    .from('bot_scheduler_jobs')
    .select('id, cloud_task_name')
    .eq('meeting_id', meetingId)
    .eq('status', 'scheduled');

  if (!jobs || jobs.length === 0) {
    return;
  }

  for (const job of jobs) {
    // Mark job as cancelled
    await supabaseAdmin
      .from('bot_scheduler_jobs')
      .update({ status: 'cancelled' })
      .eq('id', job.id);
  }
}

/**
 * Trigger bot join for a meeting
 * Called by scheduled task or immediately
 */
async function triggerBotJoin(meetingId: string, userId: string): Promise<void> {
  console.log(`[Scheduler] Triggering bot join for meeting ${meetingId}`);

  try {
    const serviceUrl = config.SERVICE_URL || `http://localhost:${config.PORT}`;

    // Call internal worker endpoint
    const response = await fetch(`${serviceUrl}/internal/worker/bot-join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.INTERNAL_SECRET ? { 'X-Internal-Secret': config.INTERNAL_SECRET } : {}),
      },
      body: JSON.stringify({ meetingId, userId }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Scheduler] Bot join failed: ${error}`);
    }
  } catch (error) {
    console.error(`[Scheduler] Failed to trigger bot join:`, error);
  }
}

/**
 * Get pending scheduled jobs for a meeting
 */
export async function getScheduledJobs(meetingId: string): Promise<any[]> {
  const { data } = await supabaseAdmin
    .from('bot_scheduler_jobs')
    .select('*')
    .eq('meeting_id', meetingId)
    .eq('status', 'scheduled');

  return data || [];
}

/**
 * Mark a scheduled job as executed
 */
export async function markJobExecuted(meetingId: string): Promise<void> {
  await supabaseAdmin
    .from('bot_scheduler_jobs')
    .update({
      status: 'executed',
      executed_at: new Date().toISOString(),
    })
    .eq('meeting_id', meetingId)
    .eq('status', 'scheduled');
}

/**
 * Mark a scheduled job as failed
 */
export async function markJobFailed(
  meetingId: string,
  errorMessage: string
): Promise<void> {
  await supabaseAdmin
    .from('bot_scheduler_jobs')
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('meeting_id', meetingId)
    .eq('status', 'scheduled');
}

const RECONCILER_INTERVAL_MS = 60 * 1000; // 1 min
const RECONCILER_TAG = '[BotJoinReconciler]';
let reconcilerTimer: NodeJS.Timeout | null = null;

/**
 * Backstop for `scheduleWithTimeout`'s in-memory timer getting dropped by a
 * Fly.io machine restart (deploy, crash) between scheduling and join time.
 * Polls for any `bot_scheduler_jobs` row that's due and still `scheduled`,
 * and triggers the join directly — same pattern as the reconcilers in
 * stuckMeetingRecovery.ts.
 */
export async function reconcileDueBotJoins(): Promise<void> {
  const { data: dueJobs, error } = await supabaseAdmin
    .from('bot_scheduler_jobs')
    .select('id, meeting_id, scheduled_for')
    .eq('status', 'scheduled')
    .lte('scheduled_for', new Date().toISOString())
    .limit(50);

  if (error) {
    console.error(`${RECONCILER_TAG} scan failed:`, error);
    return;
  }
  if (!dueJobs || dueJobs.length === 0) return;

  console.log(`${RECONCILER_TAG} found ${dueJobs.length} due job(s)`);

  for (const job of dueJobs) {
    // Claim the job first (scheduled -> executed) so a concurrent instance
    // or an in-memory timer that fires around the same time can't also
    // trigger this meeting's bot twice.
    const { data: claimed } = await supabaseAdmin
      .from('bot_scheduler_jobs')
      .update({ status: 'executed', executed_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'scheduled')
      .select('id')
      .single();

    if (!claimed) continue; // lost the race, someone else already claimed it

    const { data: meeting } = await supabaseAdmin
      .from('meetings')
      .select('id, user_id, status')
      .eq('id', job.meeting_id)
      .single();

    if (!meeting) continue;
    if (meeting.status !== 'bot_queued' && meeting.status !== 'scheduled') {
      // Already joined, cancelled, or otherwise moved on since this job was scheduled
      console.log(`${RECONCILER_TAG} skipping meeting ${meeting.id}, status is ${meeting.status}`);
      continue;
    }

    console.log(`${RECONCILER_TAG} recovering missed timer for meeting ${meeting.id}`);
    await triggerBotJoin(meeting.id, meeting.user_id);
  }
}

export function startBotJoinReconcilerLoop(): void {
  if (reconcilerTimer) return;
  reconcilerTimer = setInterval(() => {
    reconcileDueBotJoins().catch((e) => console.error(`${RECONCILER_TAG} loop error:`, e));
  }, RECONCILER_INTERVAL_MS);
  console.log(`${RECONCILER_TAG} started (interval ${RECONCILER_INTERVAL_MS / 1000}s)`);
}
