/**
 * Q&A API routes
 * Endpoints for asking questions about recordings
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import {
  answerQuestion,
  answerQuestionMock,
} from '../services/llmService.js';

import type {
  AskQuestionRequest,
  AskQuestionResponse,
  ListQuestionsResponse,
  ErrorResponse,
} from '../types/api.js';
import type { TranscriptSegment } from '../types/database.js';

const router = Router({ mergeParams: true }); // mergeParams to access :id from parent router

// All routes require authentication
router.use(authenticate);

// ============================================================================
// Validation Schemas
// ============================================================================

const askQuestionSchema = z.object({
  question: z.string().min(3).max(1000),
  include_context: z.boolean().optional().default(true),
});

const listQuestionsSchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ============================================================================
// POST /api/recordings/:id/questions
// Ask a question about a recording
// ============================================================================

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response<AskQuestionResponse | ErrorResponse>) => {
    const startTime = Date.now();
    const userId = req.user!.id;
    const recordingId = req.params.id;

    // Validate request body
    const body = askQuestionSchema.parse(req.body) as AskQuestionRequest;

    // Verify recording exists and user owns it
    const { data: recording, error: recordingError } = await supabaseAdmin
      .from('recordings')
      .select('id, status, title')
      .eq('id', recordingId)
      .eq('user_id', userId)
      .single();

    if (recordingError || !recording) {
      throw Errors.notFound('Recording');
    }

    // Check if recording has been transcribed
    if (!['transcribed', 'summarizing', 'completed'].includes(recording.status)) {
      throw Errors.unprocessable(
        'Recording must be transcribed before asking questions',
        { status: recording.status }
      );
    }

    // Fetch transcript
    const { data: transcript, error: transcriptError } = await supabaseAdmin
      .from('transcripts')
      .select('segments')
      .eq('recording_id', recordingId)
      .single();

    if (transcriptError || !transcript) {
      throw Errors.unprocessable('Transcript not found for this recording');
    }

    // Parse segments (stored as JSONB)
    const segments: TranscriptSegment[] = Array.isArray(transcript.segments)
      ? transcript.segments
      : [];

    if (segments.length === 0) {
      throw Errors.unprocessable('Recording transcript is empty');
    }

    // Fetch previous Q&A for context if requested
    let previousQA: Array<{ question: string; answer: string }> = [];
    if (body.include_context) {
      const { data: history } = await supabaseAdmin
        .from('qa_history')
        .select('question, answer')
        .eq('recording_id', recordingId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(3);

      if (history && history.length > 0) {
        previousQA = history.reverse(); // Oldest first for context
      }
    }

    // Answer the question using LLM
    let result;
    try {
      if (config.ANTHROPIC_API_KEY) {
        // Use real LLM
        result = await answerQuestion(body.question, segments, { previousQA });
      } else {
        // Use mock for development
        console.warn('ANTHROPIC_API_KEY not set, using mock Q&A');
        result = await answerQuestionMock(body.question, segments);
      }
    } catch (error) {
      console.error('LLM error:', error);
      throw Errors.internal('Failed to process question');
    }

    // Store Q&A in history
    const qaId = uuidv4();
    const createdAt = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin
      .from('qa_history')
      .insert({
        id: qaId,
        recording_id: recordingId,
        user_id: userId,
        question: body.question,
        answer: result.answer,
        citations: result.citations,
        confidence: result.confidence,
        llm_provider: config.ANTHROPIC_API_KEY ? 'anthropic' : 'mock',
        llm_model: config.ANTHROPIC_API_KEY ? config.ANTHROPIC_MODEL : 'mock',
        prompt_tokens: result.usage.input_tokens,
        completion_tokens: result.usage.output_tokens,
        processing_duration_ms: Date.now() - startTime,
      });

    if (insertError) {
      console.error('Failed to store Q&A history:', insertError);
      // Don't fail the request, just log the error
    }

    const processingTime = Date.now() - startTime;

    res.status(200).json({
      id: qaId,
      recording_id: recordingId,
      question: body.question,
      answer: result.answer,
      citations: result.citations,
      confidence: result.confidence,
      processing_time_ms: processingTime,
      created_at: createdAt,
    });
  })
);

// ============================================================================
// GET /api/recordings/:id/questions
// Get Q&A history for a recording
// ============================================================================

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response<ListQuestionsResponse | ErrorResponse>) => {
    const userId = req.user!.id;
    const recordingId = req.params.id;

    // Validate query parameters
    const query = listQuestionsSchema.parse(req.query);

    // Verify recording ownership
    const { data: recording } = await supabaseAdmin
      .from('recordings')
      .select('id')
      .eq('id', recordingId)
      .eq('user_id', userId)
      .single();

    if (!recording) {
      throw Errors.notFound('Recording');
    }

    // Fetch Q&A history
    const { data: history, error, count } = await supabaseAdmin
      .from('qa_history')
      .select('*', { count: 'exact' })
      .eq('recording_id', recordingId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);

    if (error) {
      console.error('Failed to fetch Q&A history:', error);
      throw Errors.internal('Failed to fetch Q&A history');
    }

    // Transform to response format
    const questions: AskQuestionResponse[] = (history || []).map((qa) => ({
      id: qa.id,
      recording_id: qa.recording_id,
      question: qa.question,
      answer: qa.answer,
      citations: qa.citations || [],
      confidence: qa.confidence || 0.5,
      processing_time_ms: qa.processing_duration_ms || 0,
      created_at: qa.created_at,
    }));

    res.status(200).json({
      questions,
      total_count: count || 0,
    });
  })
);

export default router;
