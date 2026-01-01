/**
 * Processing service
 * Handles async processing of recordings (transcription + summarization)
 *
 * For v1, this is a simple async function call.
 * In production, this would enqueue a Cloud Task or Pub/Sub message.
 */

import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { v4 as uuidv4 } from 'uuid';

export interface ProcessingJob {
  id: string;
  recording_id: string;
  user_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  created_at: Date;
}

/**
 * Trigger async processing for a recording
 *
 * In production, this would:
 * 1. Create a Cloud Task to call the transcription worker
 * 2. The worker would then chain to the summarization worker
 *
 * For now, we simulate by updating status and logging
 */
export async function triggerProcessing(
  recordingId: string,
  userId: string
): Promise<ProcessingJob> {
  const jobId = uuidv4();

  console.log(`[Processing] Triggering job ${jobId} for recording ${recordingId}`);

  // In production, enqueue to Cloud Tasks:
  // await enqueueCloudTask('transcription', { recording_id: recordingId, user_id: userId });

  // For now, simulate async processing
  // This runs in the background without blocking the response
  processRecordingAsync(recordingId, userId, jobId).catch((err) => {
    console.error(`[Processing] Job ${jobId} failed:`, err);
  });

  return {
    id: jobId,
    recording_id: recordingId,
    user_id: userId,
    status: 'queued',
    created_at: new Date(),
  };
}

/**
 * Simulate async processing pipeline
 * In production, this would be separate Cloud Run workers
 */
async function processRecordingAsync(
  recordingId: string,
  _userId: string,
  jobId: string
): Promise<void> {
  console.log(`[Processing] Starting job ${jobId}`);

  try {
    // Step 1: Update status to transcribing
    await updateStatus(recordingId, 'transcribing');
    console.log(`[Processing] ${jobId}: Status -> transcribing`);

    // Simulate transcription delay (in production, this calls Deepgram)
    await delay(2000);

    // Step 2: Update status to transcribed
    await updateStatus(recordingId, 'transcribed');
    console.log(`[Processing] ${jobId}: Status -> transcribed`);

    // Step 3: Update status to summarizing
    await updateStatus(recordingId, 'summarizing');
    console.log(`[Processing] ${jobId}: Status -> summarizing`);

    // Simulate summarization delay (in production, this calls the LLM)
    await delay(1000);

    // Step 4: Mark as completed
    await supabaseAdmin
      .from('recordings')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // In production, these would be set by actual processing
        speaker_count: 2,
        word_count: 150,
        language: 'en',
      })
      .eq('id', recordingId);

    console.log(`[Processing] ${jobId}: Completed successfully`);

    // In production, create placeholder transcript and summary
    // For now, we just update the status

  } catch (error) {
    console.error(`[Processing] ${jobId}: Error:`, error);

    // Mark as failed
    await supabaseAdmin
      .from('recordings')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Processing failed',
        error_code: 'PROCESSING_ERROR',
        updated_at: new Date().toISOString(),
      })
      .eq('id', recordingId);
  }
}

async function updateStatus(recordingId: string, status: string): Promise<void> {
  await supabaseAdmin
    .from('recordings')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', recordingId);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cloud Tasks integration (for production use)
 * Uncomment and configure when deploying to GCP
 */
/*
import { CloudTasksClient } from '@google-cloud/tasks';

const tasksClient = new CloudTasksClient();

async function enqueueCloudTask(
  taskType: 'transcription' | 'summarization',
  payload: Record<string, string>
): Promise<void> {
  const project = config.GCP_PROJECT_ID;
  const location = 'us-central1';
  const queue = config.CLOUD_TASKS_QUEUE || 'processing-queue';

  const parent = tasksClient.queuePath(project!, location, queue);

  const workerUrl = taskType === 'transcription'
    ? process.env.TRANSCRIPTION_WORKER_URL
    : process.env.SUMMARIZATION_WORKER_URL;

  const task = {
    httpRequest: {
      httpMethod: 'POST' as const,
      url: `${workerUrl}/process/${taskType}`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
    },
    scheduleTime: {
      seconds: Math.floor(Date.now() / 1000) + 5, // 5 second delay
    },
  };

  await tasksClient.createTask({ parent, task });
}
*/
