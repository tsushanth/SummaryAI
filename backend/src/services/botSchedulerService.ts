/**
 * Bot Scheduler Service
 * Schedules bot joins using Cloud Tasks or fallback to setTimeout
 */

import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';

// Track in-memory timers for fallback scheduling
const scheduledTimers: Map<string, NodeJS.Timeout> = new Map();

/**
 * Schedule a bot to join a meeting
 *
 * Uses Cloud Tasks in production, setTimeout in development
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

  // Use Cloud Tasks in production, setTimeout as fallback
  if (config.GCP_PROJECT_ID && config.NODE_ENV === 'production') {
    return scheduleWithCloudTasks(meetingId, userId, joinTime);
  } else {
    return scheduleWithTimeout(meetingId, userId, delayMs);
  }
}

/**
 * Schedule using Google Cloud Tasks
 */
async function scheduleWithCloudTasks(
  meetingId: string,
  userId: string,
  joinTime: Date
): Promise<string> {
  // Dynamic import to avoid requiring the package in development
  const { CloudTasksClient } = await import('@google-cloud/tasks');
  const tasksClient = new CloudTasksClient();

  const parent = tasksClient.queuePath(
    config.GCP_PROJECT_ID!,
    config.GCP_LOCATION || 'us-central1',
    config.BOT_SCHEDULER_QUEUE || 'bot-scheduler'
  );

  const task = {
    httpRequest: {
      httpMethod: 'POST' as const,
      url: `${config.SERVICE_URL}/internal/worker/bot-join`,
      headers: {
        'Content-Type': 'application/json',
        ...(config.INTERNAL_SECRET ? { 'X-Internal-Secret': config.INTERNAL_SECRET } : {}),
      },
      body: Buffer.from(
        JSON.stringify({
          meetingId,
          userId,
        })
      ).toString('base64'),
    },
    scheduleTime: {
      seconds: Math.floor(joinTime.getTime() / 1000),
    },
  };

  const [response] = await tasksClient.createTask({ parent, task });
  const taskName = response.name!;

  // Store task reference for cancellation
  await supabaseAdmin.from('bot_scheduler_jobs').insert({
    meeting_id: meetingId,
    cloud_task_name: taskName,
    scheduled_for: joinTime.toISOString(),
    status: 'scheduled',
  });

  console.log(`[Scheduler] Created Cloud Task: ${taskName}`);
  return taskName;
}

/**
 * Schedule using setTimeout (for development/testing)
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
    // Cancel Cloud Task if it's a real task name
    if (
      job.cloud_task_name &&
      !job.cloud_task_name.startsWith('timeout-') &&
      config.GCP_PROJECT_ID
    ) {
      try {
        const { CloudTasksClient } = await import('@google-cloud/tasks');
        const tasksClient = new CloudTasksClient();
        await tasksClient.deleteTask({ name: job.cloud_task_name });
        console.log(`[Scheduler] Deleted Cloud Task: ${job.cloud_task_name}`);
      } catch (err) {
        // Task may have already executed or been deleted
        console.warn(`[Scheduler] Failed to delete task ${job.cloud_task_name}:`, err);
      }
    }

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
