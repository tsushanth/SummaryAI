/**
 * Recordings API routes
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { triggerProcessing } from '../services/processingService.js';
import questionsRouter from './questions.js';

import type {
  CreateRecordingRequest,
  CreateRecordingResponse,
  CompleteUploadRequest,
  CompleteUploadResponse,
  ListRecordingsQuery,
  ListRecordingsResponse,
  GetRecordingResponse,
  ErrorResponse,
} from '../types/api.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Mount Q&A routes as nested router
router.use('/:id/questions', questionsRouter);

// ============================================================================
// Validation Schemas
// ============================================================================

const createRecordingSchema = z.object({
  title: z.string().min(1).max(255),
  duration_seconds: z.number().int().nonnegative().max(config.MAX_RECORDING_DURATION_SECONDS).optional(),
  file_size_bytes: z.number().int().positive().max(config.MAX_AUDIO_FILE_SIZE_MB * 1024 * 1024),
  content_type: z.string().optional().default('audio/mp4'),
  recording_type: z.enum(['general', 'meeting', 'lecture', 'interview', 'voice_memo', 'imported']).optional().default('general'),
});

const completeUploadSchema = z.object({
  file_size_bytes: z.number().int().positive().optional(),
  checksum: z.string().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  per_page: z.coerce.number().int().positive().max(50).optional().default(20),
  status: z.enum(['uploading', 'uploaded', 'transcribing', 'transcribed', 'summarizing', 'completed', 'failed']).optional(),
  sort: z.enum(['created_at', 'updated_at', 'title', 'duration_seconds']).optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

// ============================================================================
// POST /api/recordings
// Create a new recording and get upload URL
// ============================================================================

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response<CreateRecordingResponse | ErrorResponse>) => {
    const userId = req.user!.id;

    // Validate request body
    const body = createRecordingSchema.parse(req.body) as CreateRecordingRequest;

    // Generate recording ID and file path based on content type
    const recordingId = uuidv4();
    const isPdf = body.content_type === 'application/pdf';
    const fileExtension = isPdf ? 'pdf' : 'm4a';
    const filePath = `${userId}/${recordingId}.${fileExtension}`;

    // Create recording in database
    const { data: recording, error: insertError } = await supabaseAdmin
      .from('recordings')
      .insert({
        id: recordingId,
        user_id: userId,
        title: body.title,
        duration_seconds: body.duration_seconds || null,
        file_size_bytes: body.file_size_bytes,
        file_path: filePath,
        status: 'uploading',
        error_message: null,
        error_code: null,
        speaker_count: null,
        word_count: null,
        language: null,
        tags: [],
        is_favorite: false,
        processed_at: null,
        recording_type: body.recording_type || (isPdf ? 'imported' : 'general'),
        content_type: body.content_type || 'audio/mp4',
      })
      .select()
      .single();

    if (insertError || !recording) {
      console.error('Failed to create recording:', insertError);
      throw Errors.internal('Failed to create recording');
    }

    // Generate signed upload URL
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from(config.STORAGE_BUCKET_AUDIO)
      .createSignedUploadUrl(filePath);

    if (uploadError || !uploadData) {
      // Rollback: delete the recording
      await supabaseAdmin.from('recordings').delete().eq('id', recordingId);
      console.error('Failed to create upload URL:', uploadError);
      throw Errors.internal('Failed to create upload URL');
    }

    // Calculate expiry time
    const expiresAt = new Date(Date.now() + config.UPLOAD_URL_EXPIRY_SECONDS * 1000);

    res.status(201).json({
      recording,
      upload: {
        url: uploadData.signedUrl,
        method: 'PUT',
        headers: {
          'Content-Type': body.content_type || 'audio/mp4',
          'x-upsert': 'true',
        },
        expires_at: expiresAt.toISOString(),
      },
    });
  })
);

// ============================================================================
// POST /api/recordings/:id/complete-upload
// Signal upload completion and trigger processing
// ============================================================================

router.post(
  '/:id/complete-upload',
  asyncHandler(async (req: Request, res: Response<CompleteUploadResponse | ErrorResponse>) => {
    const userId = req.user!.id;
    const recordingId = req.params.id;

    // Validate request body (optional fields)
    const body = completeUploadSchema.parse(req.body || {}) as CompleteUploadRequest;

    // Fetch recording and verify ownership
    const { data: recording, error: fetchError } = await supabaseAdmin
      .from('recordings')
      .select('*')
      .eq('id', recordingId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !recording) {
      throw Errors.notFound('Recording');
    }

    // Verify status is 'uploading'
    if (recording.status !== 'uploading') {
      throw Errors.conflict(
        `Recording status is '${recording.status}', expected 'uploading'`
      );
    }

    // Determine file extension from file_path
    const fileExtension = recording.file_path.split('.').pop() || 'm4a';
    const fileName = `${recordingId}.${fileExtension}`;

    // Verify file exists in storage
    const { data: files, error: listError } = await supabaseAdmin.storage
      .from(config.STORAGE_BUCKET_AUDIO)
      .list(userId, {
        search: fileName,
      });

    if (listError) {
      console.error('Storage list error:', listError);
      throw Errors.internal('Failed to verify upload');
    }

    const uploadedFile = files?.find((f) => f.name === fileName);

    if (!uploadedFile) {
      throw Errors.unprocessable('File not found in storage. Please upload the file first.');
    }

    // Optionally verify file size matches
    if (body.file_size_bytes && uploadedFile.metadata?.size) {
      const actualSize = uploadedFile.metadata.size as number;
      const expectedSize = body.file_size_bytes;
      const tolerance = 0.01; // 1% tolerance for size differences

      if (Math.abs(actualSize - expectedSize) / expectedSize > tolerance) {
        throw Errors.unprocessable('File size mismatch', {
          expected: String(expectedSize),
          actual: String(actualSize),
        });
      }
    }

    // Update status to 'uploaded'
    const { data: updatedRecording, error: updateError } = await supabaseAdmin
      .from('recordings')
      .update({
        status: 'uploaded',
        file_size_bytes: uploadedFile.metadata?.size as number || recording.file_size_bytes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recordingId)
      .select()
      .single();

    if (updateError || !updatedRecording) {
      console.error('Failed to update recording:', updateError);
      throw Errors.internal('Failed to update recording status');
    }

    // Trigger async processing
    const job = await triggerProcessing(recordingId, userId);

    res.status(200).json({
      recording: updatedRecording,
      job: {
        id: job.id,
        status: 'queued',
        estimated_duration_seconds: Math.ceil((recording.duration_seconds || 60) * 0.1), // Rough estimate
      },
    });
  })
);

// ============================================================================
// GET /api/recordings
// List recordings for current user with pagination
// ============================================================================

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response<ListRecordingsResponse | ErrorResponse>) => {
    const userId = req.user!.id;

    // Parse and validate query parameters
    const query = listQuerySchema.parse(req.query) as Required<ListRecordingsQuery>;

    // Build query
    let dbQuery = supabaseAdmin
      .from('recordings')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order(query.sort, { ascending: query.order === 'asc' })
      .range((query.page - 1) * query.per_page, query.page * query.per_page - 1);

    // Filter by status if provided
    if (query.status) {
      dbQuery = dbQuery.eq('status', query.status);
    }

    const { data: recordings, error, count } = await dbQuery;

    if (error) {
      console.error('Failed to fetch recordings:', error);
      throw Errors.internal('Failed to fetch recordings');
    }

    const totalCount = count || 0;
    const totalPages = Math.ceil(totalCount / query.per_page);

    res.status(200).json({
      recordings: recordings || [],
      meta: {
        page: query.page,
        per_page: query.per_page,
        total_count: totalCount,
        total_pages: totalPages,
      },
    });
  })
);

// ============================================================================
// GET /api/recordings/:id
// Get recording details with optional transcript and summary
// ============================================================================

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response<GetRecordingResponse | ErrorResponse>) => {
    const userId = req.user!.id;
    const recordingId = req.params.id;

    // Parse include parameter
    const includeParam = req.query.include as string | undefined;
    const includes = includeParam?.split(',').map((s) => s.trim()) || [];
    const includeTranscript = includes.includes('transcript');
    const includeSummary = includes.includes('summary');

    // Fetch recording
    const { data: recording, error: recordingError } = await supabaseAdmin
      .from('recordings')
      .select('*')
      .eq('id', recordingId)
      .eq('user_id', userId)
      .single();

    if (recordingError || !recording) {
      throw Errors.notFound('Recording');
    }

    const response: GetRecordingResponse = { recording };

    // Fetch transcript if requested and available
    if (includeTranscript && ['transcribed', 'summarizing', 'completed'].includes(recording.status)) {
      const { data: transcript } = await supabaseAdmin
        .from('transcripts')
        .select('*')
        .eq('recording_id', recordingId)
        .single();

      if (transcript) {
        response.transcript = transcript;
      }
    }

    // Fetch summary if requested and available
    if (includeSummary && recording.status === 'completed') {
      const { data: summary } = await supabaseAdmin
        .from('summaries')
        .select('*')
        .eq('recording_id', recordingId)
        .single();

      if (summary) {
        response.summary = summary;
      }
    }

    // Generate signed audio URL if recording is processed
    if (['uploaded', 'transcribing', 'transcribed', 'summarizing', 'completed'].includes(recording.status)) {
      const { data: signedUrlData } = await supabaseAdmin.storage
        .from(config.STORAGE_BUCKET_AUDIO)
        .createSignedUrl(recording.file_path, 3600); // 1 hour expiry

      if (signedUrlData) {
        response.audio_url = signedUrlData.signedUrl;
        response.audio_url_expires_at = new Date(Date.now() + 3600 * 1000).toISOString();
      }
    }

    res.status(200).json(response);
  })
);

// ============================================================================
// PATCH /api/recordings/:id
// Update recording metadata
// ============================================================================

const updateRecordingSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  tags: z.array(z.string()).optional(),
  is_favorite: z.boolean().optional(),
});

router.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const recordingId = req.params.id;

    // Validate request body
    const body = updateRecordingSchema.parse(req.body);

    // Check if there's anything to update
    if (Object.keys(body).length === 0) {
      throw Errors.badRequest('No fields to update');
    }

    // Verify ownership first
    const { data: existing } = await supabaseAdmin
      .from('recordings')
      .select('id')
      .eq('id', recordingId)
      .eq('user_id', userId)
      .single();

    if (!existing) {
      throw Errors.notFound('Recording');
    }

    // Update recording
    const { data: recording, error } = await supabaseAdmin
      .from('recordings')
      .update({
        ...body,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recordingId)
      .select()
      .single();

    if (error || !recording) {
      console.error('Failed to update recording:', error);
      throw Errors.internal('Failed to update recording');
    }

    res.status(200).json({ recording });
  })
);

// ============================================================================
// DELETE /api/recordings/:id
// Delete recording and associated data
// ============================================================================

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const recordingId = req.params.id;

    // Fetch recording to get file path
    const { data: recording } = await supabaseAdmin
      .from('recordings')
      .select('id, file_path')
      .eq('id', recordingId)
      .eq('user_id', userId)
      .single();

    if (!recording) {
      throw Errors.notFound('Recording');
    }

    // Delete from storage
    const { error: storageError } = await supabaseAdmin.storage
      .from(config.STORAGE_BUCKET_AUDIO)
      .remove([recording.file_path]);

    if (storageError) {
      console.warn('Failed to delete audio file:', storageError);
      // Continue with database deletion even if storage fails
    }

    // Delete from database (cascades to transcripts, summaries, qa_history)
    const { error: deleteError } = await supabaseAdmin
      .from('recordings')
      .delete()
      .eq('id', recordingId);

    if (deleteError) {
      console.error('Failed to delete recording:', deleteError);
      throw Errors.internal('Failed to delete recording');
    }

    res.status(204).send();
  })
);

export default router;
