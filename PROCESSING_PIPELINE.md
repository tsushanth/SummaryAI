# Summary AI - Transcription & Summarization Pipeline

## Overview

This document details the processing pipeline that transforms uploaded audio recordings into searchable transcripts with AI-generated summaries, key points, and action items.

---

## 1. Transcription Provider Selection

### Choice: Deepgram Nova-2

**Why Deepgram over alternatives:**

| Provider | Diarization | Word Timestamps | Price/min | Speed | Notes |
|----------|-------------|-----------------|-----------|-------|-------|
| **Deepgram Nova-2** | ✅ Native | ✅ Yes | $0.0043 | ~0.1x RT | Best balance of features/price |
| OpenAI Whisper API | ❌ No | ✅ Yes | $0.006 | ~0.5x RT | No speaker labels |
| AssemblyAI | ✅ Native | ✅ Yes | $0.0065 | ~0.3x RT | Good but pricier |
| Google STT | ✅ Paid add-on | ✅ Yes | $0.004+ | ~0.3x RT | Complex pricing |
| Local Whisper | ❌ No | ✅ Yes | Compute | Varies | Self-hosted complexity |

**Deepgram advantages for Summary AI:**
1. **Native speaker diarization** - Critical for meeting transcripts
2. **Word-level timestamps** - Enables precise Q&A citations
3. **Fast processing** - Often faster than real-time
4. **Streaming upload** - Don't need to download full file first
5. **Smart formatting** - Auto punctuation, paragraphs
6. **Simple API** - Clean SDK, good error handling

---

## 2. Pipeline Step-by-Step

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PROCESSING PIPELINE - DETAILED FLOW                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. UPLOAD COMPLETE SIGNAL                                                  │
│     ────────────────────────────────────────────────────────────────────    │
│     Client: POST /recordings/:id/upload-complete                            │
│                          │                                                  │
│                          ▼                                                  │
│     ┌─────────────────────────────────────────┐                            │
│     │ Verify file exists in Supabase Storage  │                            │
│     │ Update status: 'uploading' → 'uploaded' │                            │
│     │ Enqueue transcription task              │                            │
│     └─────────────────────────────────────────┘                            │
│                          │                                                  │
│                          ▼                                                  │
│  2. TRANSCRIPTION WORKER                                                    │
│     ────────────────────────────────────────────────────────────────────    │
│     ┌─────────────────────────────────────────┐                            │
│     │ a) Update status → 'transcribing'       │                            │
│     │ b) Get signed URL from Supabase Storage │                            │
│     │ c) Stream audio URL to Deepgram API     │                            │
│     │ d) Receive transcript with:             │                            │
│     │    - Utterances (speaker turns)         │                            │
│     │    - Word-level timestamps              │                            │
│     │    - Speaker labels (diarization)       │                            │
│     │    - Confidence scores                  │                            │
│     │ e) Transform to our segment format      │                            │
│     │ f) Store in 'transcripts' table         │                            │
│     │ g) Update recording metadata            │                            │
│     │ h) Update status → 'transcribed'        │                            │
│     │ i) Enqueue summarization task           │                            │
│     └─────────────────────────────────────────┘                            │
│                          │                                                  │
│                          ▼                                                  │
│  3. SUMMARIZATION WORKER                                                    │
│     ────────────────────────────────────────────────────────────────────    │
│     ┌─────────────────────────────────────────┐                            │
│     │ a) Update status → 'summarizing'        │                            │
│     │ b) Fetch transcript from database       │                            │
│     │ c) Chunk transcript if needed           │                            │
│     │ d) Generate summary via LLM:            │                            │
│     │    - Overall summary (2-3 paragraphs)   │                            │
│     │    - Key points (bullet list)           │                            │
│     │    - Action items (with assignees)      │                            │
│     │    - Topics/themes                      │                            │
│     │    - Sentiment (optional)               │                            │
│     │ e) Store in 'summaries' table           │                            │
│     │ f) Update status → 'completed'          │                            │
│     │ g) Send push notification to user       │                            │
│     └─────────────────────────────────────────┘                            │
│                          │                                                  │
│                          ▼                                                  │
│  4. COMPLETION                                                              │
│     ────────────────────────────────────────────────────────────────────    │
│     Recording is now fully processed and searchable                         │
│     User can view transcript, summary, and ask questions                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Detailed Steps

#### Step 1: Upload Complete Signal

```typescript
// API endpoint handler
async function handleUploadComplete(recordingId: string, userId: string) {
  // 1. Verify recording exists and belongs to user
  const recording = await db.recordings.findUnique({
    where: { id: recordingId, user_id: userId }
  });

  if (!recording) throw new NotFoundError('Recording not found');
  if (recording.status !== 'uploading') {
    throw new ConflictError(`Recording status is ${recording.status}, expected 'uploading'`);
  }

  // 2. Verify file exists in storage
  const { data: fileInfo, error } = await supabase.storage
    .from('recordings-audio')
    .list(userId, { search: `${recordingId}.m4a` });

  if (error || !fileInfo?.length) {
    throw new UnprocessableError('Audio file not found in storage');
  }

  // 3. Update status
  await db.recordings.update({
    where: { id: recordingId },
    data: { status: 'uploaded', updated_at: new Date() }
  });

  // 4. Enqueue transcription task
  await enqueueTask('transcription', {
    recording_id: recordingId,
    user_id: userId,
    audio_path: `${userId}/${recordingId}.m4a`,
    retry_count: 0
  });

  return { status: 'uploaded', job_queued: true };
}
```

#### Step 2: Transcription Worker

```typescript
// Worker receives task from Cloud Tasks queue
async function processTranscription(task: TranscriptionTask) {
  const { recording_id, user_id, audio_path } = task;

  // a) Update status
  await updateRecordingStatus(recording_id, 'transcribing');

  // b) Get signed URL (valid for 1 hour)
  const { data: signedUrlData } = await supabaseAdmin.storage
    .from('recordings-audio')
    .createSignedUrl(audio_path, 3600);

  const audioUrl = signedUrlData.signedUrl;

  // c) Send to Deepgram
  const deepgramResult = await transcribeWithDeepgram(audioUrl);

  // d) Transform result to our format
  const segments = transformToSegments(deepgramResult);
  const fullText = segments.map(s => s.text).join(' ');

  // e) Store transcript
  await db.transcripts.create({
    data: {
      recording_id,
      full_text: fullText,
      segments: segments,
      word_count: countWords(deepgramResult),
      speaker_count: countSpeakers(segments),
      language: deepgramResult.detected_language || 'en',
      transcription_provider: 'deepgram',
      transcription_model: 'nova-2'
    }
  });

  // f) Update recording metadata
  await db.recordings.update({
    where: { id: recording_id },
    data: {
      status: 'transcribed',
      speaker_count: countSpeakers(segments),
      word_count: countWords(deepgramResult),
      language: deepgramResult.detected_language || 'en',
      updated_at: new Date()
    }
  });

  // g) Enqueue summarization
  await enqueueTask('summarization', {
    recording_id,
    user_id,
    retry_count: 0
  });
}
```

#### Step 3: Summarization Worker

```typescript
async function processSummarization(task: SummarizationTask) {
  const { recording_id, user_id } = task;

  // a) Update status
  await updateRecordingStatus(recording_id, 'summarizing');

  // b) Fetch transcript
  const transcript = await db.transcripts.findUnique({
    where: { recording_id }
  });

  // c) Prepare transcript for LLM (chunk if needed)
  const preparedTranscript = prepareTranscriptForLLM(transcript);

  // d) Generate summary via LLM
  const summaryResult = await generateSummary(preparedTranscript);

  // e) Store summary
  await db.summaries.create({
    data: {
      recording_id,
      summary: summaryResult.summary,
      key_points: summaryResult.keyPoints,
      action_items: summaryResult.actionItems,
      topics: summaryResult.topics,
      sentiment: summaryResult.sentiment,
      llm_provider: 'anthropic',
      llm_model: 'claude-3-5-sonnet-20241022',
      prompt_tokens: summaryResult.usage.promptTokens,
      completion_tokens: summaryResult.usage.completionTokens
    }
  });

  // f) Update status to completed
  await db.recordings.update({
    where: { id: recording_id },
    data: {
      status: 'completed',
      processed_at: new Date(),
      updated_at: new Date()
    }
  });

  // g) Send push notification
  await sendPushNotification(user_id, {
    title: 'Recording Ready',
    body: 'Your recording has been transcribed and summarized.',
    data: { recording_id }
  });
}
```

---

## 3. TypeScript Types

### Transcript Types

```typescript
// ============================================================================
// TRANSCRIPT TYPES
// ============================================================================

/**
 * Word-level timing information from transcription
 */
interface TranscriptWord {
  /** The transcribed word (with punctuation if smart_format enabled) */
  word: string;

  /** Start time in seconds from beginning of audio */
  start_time: number;

  /** End time in seconds */
  end_time: number;

  /** Confidence score from 0.0 to 1.0 */
  confidence: number;

  /** Speaker index (0-based) if diarization enabled */
  speaker?: number;
}

/**
 * A segment represents a continuous speech turn by one speaker
 */
interface TranscriptSegment {
  /** Unique identifier for this segment */
  id: string;

  /** Display label for speaker (e.g., "Speaker 1", or name if known) */
  speaker_label: string;

  /** Zero-based speaker index for consistent coloring */
  speaker_index: number;

  /** The transcribed text for this segment */
  text: string;

  /** Start time in seconds */
  start_time: number;

  /** End time in seconds */
  end_time: number;

  /** Overall confidence for this segment (0.0 to 1.0) */
  confidence: number;

  /** Optional word-level detail for precise highlighting */
  words?: TranscriptWord[];
}

/**
 * Complete transcript for a recording
 */
interface Transcript {
  /** Unique transcript ID */
  id: string;

  /** Associated recording ID */
  recording_id: string;

  /** Full concatenated text (for search indexing) */
  full_text: string;

  /** Array of transcript segments */
  segments: TranscriptSegment[];

  /** Total word count */
  word_count: number;

  /** Number of unique speakers detected */
  speaker_count: number;

  /** Detected or specified language (ISO 639-1 code) */
  language: string;

  /** Transcription service used */
  transcription_provider: 'deepgram' | 'whisper' | 'assemblyai';

  /** Specific model version */
  transcription_model: string;

  /** Processing time in milliseconds */
  processing_duration_ms?: number;

  /** When transcript was created */
  created_at: Date;
}

/**
 * Raw response from Deepgram API (simplified)
 */
interface DeepgramResponse {
  metadata: {
    request_id: string;
    created: string;
    duration: number;
    channels: number;
  };
  results: {
    channels: Array<{
      alternatives: Array<{
        transcript: string;
        confidence: number;
        words: Array<{
          word: string;
          start: number;
          end: number;
          confidence: number;
          speaker?: number;
          punctuated_word?: string;
        }>;
        paragraphs?: {
          paragraphs: Array<{
            sentences: Array<{
              text: string;
              start: number;
              end: number;
            }>;
            speaker: number;
            start: number;
            end: number;
          }>;
        };
      }>;
      detected_language?: string;
    }>;
    utterances?: Array<{
      start: number;
      end: number;
      confidence: number;
      channel: number;
      transcript: string;
      words: Array<{
        word: string;
        start: number;
        end: number;
        confidence: number;
        punctuated_word?: string;
      }>;
      speaker: number;
      id: string;
    }>;
  };
}
```

### Summary Types

```typescript
// ============================================================================
// SUMMARY TYPES
// ============================================================================

/**
 * Extracted action item from the recording
 */
interface ActionItem {
  /** Description of the action to be taken */
  text: string;

  /** Person assigned (extracted from transcript, may be null) */
  assignee: string | null;

  /** Due date as mentioned (raw text like "by Friday", "next week") */
  due_date: string | null;

  /** Inferred priority based on language/context */
  priority: 'high' | 'medium' | 'low' | null;

  /** Optional: segment ID where this was mentioned */
  source_segment_id?: string;
}

/**
 * Sentiment analysis result
 */
interface Sentiment {
  /** Overall sentiment classification */
  overall: 'positive' | 'neutral' | 'negative' | 'mixed';

  /** Sentiment score from -1.0 (negative) to 1.0 (positive) */
  score: number;

  /** Optional breakdown by section */
  breakdown?: Array<{
    section: string;
    sentiment: 'positive' | 'neutral' | 'negative';
    score: number;
  }>;
}

/**
 * Complete summary result from LLM
 */
interface SummaryResult {
  /** 2-3 paragraph narrative summary */
  summary: string;

  /** 4-8 key points as bullet items */
  key_points: string[];

  /** Extracted action items with metadata */
  action_items: ActionItem[];

  /** Main topics/themes discussed */
  topics: string[];

  /** Optional sentiment analysis */
  sentiment?: Sentiment;

  /** Token usage for cost tracking */
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * Stored summary in database
 */
interface Summary {
  id: string;
  recording_id: string;
  summary: string;
  key_points: string[];  // Stored as JSONB
  action_items: ActionItem[];  // Stored as JSONB
  topics: string[];  // Stored as JSONB
  sentiment: Sentiment | null;  // Stored as JSONB
  llm_provider: string;
  llm_model: string;
  prompt_tokens: number;
  completion_tokens: number;
  processing_duration_ms?: number;
  created_at: Date;
}

/**
 * LLM response for summary generation (Claude format)
 */
interface LLMSummaryResponse {
  content: Array<{
    type: 'text';
    text: string;  // JSON string matching SummarySchema
  }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
}
```

### Q&A Types

```typescript
// ============================================================================
// Q&A TYPES
// ============================================================================

/**
 * Citation referencing a specific part of the transcript
 */
interface Citation {
  /** Reference to the segment ID */
  segment_id: string;

  /** Timestamp in seconds for seeking */
  timestamp: number;

  /** Quoted text from the transcript */
  text: string;

  /** How relevant this citation is to the answer (0.0 to 1.0) */
  relevance_score: number;
}

/**
 * Q&A request from client
 */
interface QARequest {
  /** The user's question */
  question: string;

  /** Whether to include previous Q&A as context */
  include_context?: boolean;
}

/**
 * Q&A response
 */
interface QAResponse {
  id: string;
  recording_id: string;
  question: string;
  answer: string;
  citations: Citation[];
  confidence: number;
  created_at: Date;
}

/**
 * Context chunk for RAG
 */
interface TranscriptChunk {
  /** Chunk identifier */
  chunk_id: string;

  /** Text content of this chunk */
  text: string;

  /** Start segment index */
  start_segment_index: number;

  /** End segment index */
  end_segment_index: number;

  /** Start time in seconds */
  start_time: number;

  /** End time in seconds */
  end_time: number;

  /** Token count (approximate) */
  token_count: number;
}
```

---

## 4. Core Processing Functions

### Main Processing Function

```typescript
// ============================================================================
// processRecording - Main Orchestration Function
// ============================================================================

import { createClient } from '@deepgram/sdk';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from './lib/supabase';
import { config } from './config';

/**
 * Process a recording through the full pipeline:
 * transcription → summarization → completion
 *
 * This function is typically called by the transcription worker,
 * but can also be used for reprocessing.
 */
async function processRecording(
  recordingId: string,
  options: {
    skipTranscription?: boolean;  // Use existing transcript
    skipSummarization?: boolean;  // Only transcribe
  } = {}
): Promise<void> {
  const startTime = Date.now();

  try {
    // =========================================================================
    // 1. FETCH RECORDING METADATA
    // =========================================================================
    const { data: recording, error: fetchError } = await supabaseAdmin
      .from('recordings')
      .select('*')
      .eq('id', recordingId)
      .single();

    if (fetchError || !recording) {
      throw new Error(`Recording not found: ${recordingId}`);
    }

    console.log(`[${recordingId}] Starting processing for: ${recording.title}`);

    // =========================================================================
    // 2. TRANSCRIPTION PHASE
    // =========================================================================
    let transcript: Transcript;

    if (options.skipTranscription) {
      // Use existing transcript
      const { data: existingTranscript } = await supabaseAdmin
        .from('transcripts')
        .select('*')
        .eq('recording_id', recordingId)
        .single();

      if (!existingTranscript) {
        throw new Error('No existing transcript found');
      }
      transcript = existingTranscript;
      console.log(`[${recordingId}] Using existing transcript`);
    } else {
      // Perform transcription
      await updateRecordingStatus(recordingId, 'transcribing');

      // Get signed URL for audio file
      const audioUrl = await getSignedAudioUrl(recording.file_path);

      // Transcribe with Deepgram
      const deepgramResult = await transcribeAudio(audioUrl);

      // Transform and store transcript
      transcript = await storeTranscript(recordingId, deepgramResult);

      // Update recording with transcript metadata
      await supabaseAdmin
        .from('recordings')
        .update({
          status: 'transcribed',
          speaker_count: transcript.speaker_count,
          word_count: transcript.word_count,
          language: transcript.language,
          updated_at: new Date().toISOString()
        })
        .eq('id', recordingId);

      console.log(`[${recordingId}] Transcription complete: ${transcript.word_count} words, ${transcript.speaker_count} speakers`);
    }

    // =========================================================================
    // 3. SUMMARIZATION PHASE
    // =========================================================================
    if (!options.skipSummarization) {
      await updateRecordingStatus(recordingId, 'summarizing');

      // Generate summary with LLM
      const summaryResult = await generateSummaryWithLLM(transcript);

      // Store summary
      await supabaseAdmin.from('summaries').upsert({
        recording_id: recordingId,
        summary: summaryResult.summary,
        key_points: summaryResult.key_points,
        action_items: summaryResult.action_items,
        topics: summaryResult.topics,
        sentiment: summaryResult.sentiment,
        llm_provider: 'anthropic',
        llm_model: config.ANTHROPIC_MODEL,
        prompt_tokens: summaryResult.usage.prompt_tokens,
        completion_tokens: summaryResult.usage.completion_tokens,
        processing_duration_ms: Date.now() - startTime
      }, {
        onConflict: 'recording_id'
      });

      console.log(`[${recordingId}] Summarization complete: ${summaryResult.key_points.length} key points, ${summaryResult.action_items.length} action items`);
    }

    // =========================================================================
    // 4. MARK AS COMPLETED
    // =========================================================================
    await supabaseAdmin
      .from('recordings')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', recordingId);

    const totalTime = Date.now() - startTime;
    console.log(`[${recordingId}] Processing complete in ${totalTime}ms`);

  } catch (error) {
    console.error(`[${recordingId}] Processing failed:`, error);

    // Update status to failed
    await supabaseAdmin
      .from('recordings')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        error_code: categorizeError(error),
        updated_at: new Date().toISOString()
      })
      .eq('id', recordingId);

    throw error;  // Re-throw for retry handling
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function getSignedAudioUrl(filePath: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from('recordings-audio')
    .createSignedUrl(filePath, 3600);  // 1 hour validity

  if (error || !data) {
    throw new Error(`Failed to get signed URL: ${error?.message}`);
  }

  return data.signedUrl;
}

async function updateRecordingStatus(
  recordingId: string,
  status: RecordingStatus
): Promise<void> {
  await supabaseAdmin
    .from('recordings')
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq('id', recordingId);
}

function categorizeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('Deepgram')) return 'TRANSCRIPTION_ERROR';
    if (error.message.includes('Anthropic')) return 'SUMMARIZATION_ERROR';
    if (error.message.includes('storage')) return 'STORAGE_ERROR';
  }
  return 'UNKNOWN_ERROR';
}
```

### Transcription Function

```typescript
// ============================================================================
// DEEPGRAM TRANSCRIPTION
// ============================================================================

import { createClient, PrerecordedTranscriptionResponse } from '@deepgram/sdk';

const deepgram = createClient(config.DEEPGRAM_API_KEY);

async function transcribeAudio(audioUrl: string): Promise<DeepgramResponse> {
  const startTime = Date.now();

  const { result, error } = await deepgram.listen.prerecorded.transcribeUrl(
    { url: audioUrl },
    {
      // Model selection
      model: 'nova-2',
      language: 'en',

      // Core features
      smart_format: true,     // Auto punctuation and formatting
      diarize: true,          // Speaker identification
      punctuate: true,        // Add punctuation
      paragraphs: true,       // Group into paragraphs
      utterances: true,       // Get speaker turns

      // Additional features
      detect_language: true,  // Auto-detect language
      filler_words: false,    // Remove "um", "uh"

      // Word-level detail
      // words: true is implied when utterances: true
    }
  );

  if (error) {
    throw new Error(`Deepgram transcription failed: ${error.message}`);
  }

  console.log(`Transcription completed in ${Date.now() - startTime}ms`);

  return result as DeepgramResponse;
}

/**
 * Transform Deepgram response to our segment format
 */
function transformDeepgramToSegments(result: DeepgramResponse): TranscriptSegment[] {
  const utterances = result.results.utterances;

  if (!utterances || utterances.length === 0) {
    // Fallback: use paragraphs if utterances not available
    return transformFromParagraphs(result);
  }

  return utterances.map((utterance, index) => ({
    id: `seg-${String(index).padStart(4, '0')}`,
    speaker_label: `Speaker ${utterance.speaker + 1}`,
    speaker_index: utterance.speaker,
    text: utterance.transcript.trim(),
    start_time: utterance.start,
    end_time: utterance.end,
    confidence: utterance.confidence,
    words: utterance.words.map(word => ({
      word: word.punctuated_word || word.word,
      start_time: word.start,
      end_time: word.end,
      confidence: word.confidence
    }))
  }));
}

function transformFromParagraphs(result: DeepgramResponse): TranscriptSegment[] {
  const channel = result.results.channels[0];
  const paragraphs = channel.alternatives[0].paragraphs?.paragraphs || [];

  return paragraphs.flatMap((para, paraIndex) =>
    para.sentences.map((sentence, sentIndex) => ({
      id: `seg-${String(paraIndex).padStart(3, '0')}-${String(sentIndex).padStart(2, '0')}`,
      speaker_label: `Speaker ${para.speaker + 1}`,
      speaker_index: para.speaker,
      text: sentence.text.trim(),
      start_time: sentence.start,
      end_time: sentence.end,
      confidence: channel.alternatives[0].confidence,
      words: undefined  // Not available at sentence level
    }))
  );
}

async function storeTranscript(
  recordingId: string,
  deepgramResult: DeepgramResponse
): Promise<Transcript> {
  const segments = transformDeepgramToSegments(deepgramResult);
  const fullText = segments.map(s => s.text).join(' ');

  const channel = deepgramResult.results.channels[0];
  const wordCount = channel.alternatives[0].words?.length || 0;
  const speakerCount = new Set(segments.map(s => s.speaker_index)).size;
  const language = channel.detected_language || 'en';

  const transcriptData = {
    recording_id: recordingId,
    full_text: fullText,
    segments: segments,  // Will be stored as JSONB
    word_count: wordCount,
    speaker_count: speakerCount,
    language: language,
    transcription_provider: 'deepgram',
    transcription_model: 'nova-2',
    processing_duration_ms: deepgramResult.metadata.duration * 1000
  };

  const { data, error } = await supabaseAdmin
    .from('transcripts')
    .upsert(transcriptData, { onConflict: 'recording_id' })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to store transcript: ${error.message}`);
  }

  return data;
}
```

### Summarization Function

```typescript
// ============================================================================
// LLM SUMMARIZATION
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY
});

async function generateSummaryWithLLM(transcript: Transcript): Promise<SummaryResult> {
  // Prepare transcript text with speaker labels
  const transcriptText = prepareTranscriptForLLM(transcript);

  // Check if we need to chunk
  const estimatedTokens = estimateTokenCount(transcriptText);

  if (estimatedTokens > 150000) {  // Claude's context is 200K, leave room for response
    return generateChunkedSummary(transcript);
  }

  // Single-pass summarization for normal-length transcripts
  const message = await anthropic.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: buildSummaryPrompt(transcriptText)
      }
    ]
  });

  // Parse the JSON response
  const responseText = message.content[0].type === 'text'
    ? message.content[0].text
    : '';

  const parsedResult = parseSummaryResponse(responseText);

  return {
    ...parsedResult,
    usage: {
      prompt_tokens: message.usage.input_tokens,
      completion_tokens: message.usage.output_tokens
    }
  };
}

function prepareTranscriptForLLM(transcript: Transcript): string {
  const lines: string[] = [];

  for (const segment of transcript.segments) {
    const timestamp = formatTimestamp(segment.start_time);
    lines.push(`[${timestamp}] ${segment.speaker_label}: ${segment.text}`);
  }

  return lines.join('\n');
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function estimateTokenCount(text: string): number {
  // Rough estimation: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}
```

---

## 5. Chunking Strategies

### 5.1 Chunking for Summarization

For transcripts exceeding the context window, we use a **hierarchical summarization** approach:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HIERARCHICAL SUMMARIZATION                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Long Transcript (e.g., 3 hour meeting)                                     │
│  ───────────────────────────────────────────────────────────────────────    │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │   Chunk 1    │ │   Chunk 2    │ │   Chunk 3    │ │   Chunk 4    │       │
│  │  (30 min)    │ │  (30 min)    │ │  (30 min)    │ │  (30 min)    │       │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘       │
│         │                │                │                │                │
│         ▼                ▼                ▼                ▼                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │  Summary 1   │ │  Summary 2   │ │  Summary 3   │ │  Summary 4   │       │
│  │ Key Points 1 │ │ Key Points 2 │ │ Key Points 3 │ │ Key Points 4 │       │
│  │  Actions 1   │ │  Actions 2   │ │  Actions 3   │ │  Actions 4   │       │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘       │
│         │                │                │                │                │
│         └────────────────┴────────────────┴────────────────┘                │
│                                    │                                        │
│                                    ▼                                        │
│                         ┌────────────────────┐                              │
│                         │   FINAL SUMMARY    │                              │
│                         │   Merged Key Pts   │                              │
│                         │   Deduped Actions  │                              │
│                         │   Combined Topics  │                              │
│                         └────────────────────┘                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

```typescript
// ============================================================================
// CHUNKED SUMMARIZATION
// ============================================================================

interface TranscriptChunk {
  chunk_index: number;
  segments: TranscriptSegment[];
  text: string;
  start_time: number;
  end_time: number;
  token_count: number;
}

const CHUNK_CONFIG = {
  maxTokensPerChunk: 50000,      // Leave room for prompt and response
  overlapSegments: 2,            // Overlap for context continuity
  minSegmentsPerChunk: 10        // Don't create tiny chunks
};

function chunkTranscript(transcript: Transcript): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let currentChunk: TranscriptSegment[] = [];
  let currentTokenCount = 0;
  let chunkIndex = 0;

  for (let i = 0; i < transcript.segments.length; i++) {
    const segment = transcript.segments[i];
    const segmentTokens = estimateTokenCount(segment.text);

    // Check if adding this segment would exceed the limit
    if (currentTokenCount + segmentTokens > CHUNK_CONFIG.maxTokensPerChunk
        && currentChunk.length >= CHUNK_CONFIG.minSegmentsPerChunk) {
      // Save current chunk
      chunks.push(createChunk(currentChunk, chunkIndex));
      chunkIndex++;

      // Start new chunk with overlap
      const overlapStart = Math.max(0, currentChunk.length - CHUNK_CONFIG.overlapSegments);
      currentChunk = currentChunk.slice(overlapStart);
      currentTokenCount = currentChunk.reduce((sum, s) => sum + estimateTokenCount(s.text), 0);
    }

    currentChunk.push(segment);
    currentTokenCount += segmentTokens;
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(createChunk(currentChunk, chunkIndex));
  }

  return chunks;
}

function createChunk(segments: TranscriptSegment[], index: number): TranscriptChunk {
  return {
    chunk_index: index,
    segments: segments,
    text: segments.map(s => `[${formatTimestamp(s.start_time)}] ${s.speaker_label}: ${s.text}`).join('\n'),
    start_time: segments[0].start_time,
    end_time: segments[segments.length - 1].end_time,
    token_count: segments.reduce((sum, s) => sum + estimateTokenCount(s.text), 0)
  };
}

async function generateChunkedSummary(transcript: Transcript): Promise<SummaryResult> {
  const chunks = chunkTranscript(transcript);
  console.log(`Processing ${chunks.length} chunks for long transcript`);

  // Phase 1: Summarize each chunk
  const chunkSummaries = await Promise.all(
    chunks.map((chunk, index) =>
      summarizeChunk(chunk, index, chunks.length)
    )
  );

  // Phase 2: Merge chunk summaries into final summary
  const mergedSummary = await mergeSummaries(chunkSummaries, transcript);

  return mergedSummary;
}

async function summarizeChunk(
  chunk: TranscriptChunk,
  chunkIndex: number,
  totalChunks: number
): Promise<SummaryResult> {
  const timeRange = `${formatTimestamp(chunk.start_time)} - ${formatTimestamp(chunk.end_time)}`;

  const message = await anthropic.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: buildChunkSummaryPrompt(chunk.text, chunkIndex + 1, totalChunks, timeRange)
      }
    ]
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  return parseSummaryResponse(responseText);
}

async function mergeSummaries(
  chunkSummaries: SummaryResult[],
  transcript: Transcript
): Promise<SummaryResult> {
  // Combine all chunk summaries
  const combinedInput = chunkSummaries.map((summary, index) => `
## Part ${index + 1}

**Summary:** ${summary.summary}

**Key Points:**
${summary.key_points.map(p => `- ${p}`).join('\n')}

**Action Items:**
${summary.action_items.map(a => `- ${a.text}${a.assignee ? ` (${a.assignee})` : ''}`).join('\n')}
`).join('\n---\n');

  const message = await anthropic.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: buildMergeSummaryPrompt(combinedInput, transcript.speaker_count)
      }
    ]
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  const result = parseSummaryResponse(responseText);

  // Aggregate token usage
  const totalUsage = chunkSummaries.reduce(
    (acc, s) => ({
      prompt_tokens: acc.prompt_tokens + (s.usage?.prompt_tokens || 0),
      completion_tokens: acc.completion_tokens + (s.usage?.completion_tokens || 0)
    }),
    { prompt_tokens: message.usage.input_tokens, completion_tokens: message.usage.output_tokens }
  );

  return { ...result, usage: totalUsage };
}
```

### 5.2 Chunking for Q&A (RAG Style)

For Q&A, we use a **retrieval-augmented generation** approach with semantic chunking:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Q&A RAG PIPELINE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User Question: "What were the main blockers discussed?"                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 1. RETRIEVE RELEVANT CHUNKS                                          │   │
│  │    ─────────────────────────────────────────────────────────────     │   │
│  │    Option A: Keyword Search (Simple)                                 │   │
│  │    - Full-text search on transcript                                  │   │
│  │    - Match segments containing "blocker", "blocked", "issue", etc.   │   │
│  │                                                                      │   │
│  │    Option B: Semantic Search (Advanced)                              │   │
│  │    - Embed question with text-embedding model                        │   │
│  │    - Find nearest neighbor chunks by cosine similarity               │   │
│  │    - (Requires pre-computed embeddings for transcript chunks)        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 2. RANK AND SELECT TOP CHUNKS                                        │   │
│  │    ─────────────────────────────────────────────────────────────     │   │
│  │    - Score by relevance (BM25 or embedding similarity)               │   │
│  │    - Take top 5-10 most relevant chunks                              │   │
│  │    - Ensure total context fits in LLM window                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 3. GENERATE ANSWER WITH CONTEXT                                      │   │
│  │    ─────────────────────────────────────────────────────────────     │   │
│  │    Prompt:                                                           │   │
│  │    "Given these transcript excerpts, answer the question.            │   │
│  │     Cite specific timestamps when referencing the transcript."       │   │
│  │                                                                      │   │
│  │    [Relevant chunks with timestamps]                                 │   │
│  │                                                                      │   │
│  │    Question: "What were the main blockers discussed?"                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 4. RESPONSE WITH CITATIONS                                           │   │
│  │    ─────────────────────────────────────────────────────────────     │   │
│  │    "The main blockers discussed were:                                │   │
│  │     1. Mobile team blocked on auth endpoint [05:23]                  │   │
│  │     2. Waiting for design approval [12:45]                           │   │
│  │     ..."                                                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────��───────────────────────────────┘
```

```typescript
// ============================================================================
// Q&A WITH RAG
// ============================================================================

interface RelevantChunk {
  segment: TranscriptSegment;
  score: number;
  matchedTerms: string[];
}

async function answerQuestion(
  recordingId: string,
  question: string,
  includeHistory: boolean = true
): Promise<QAResponse> {
  // Fetch transcript
  const { data: transcript } = await supabaseAdmin
    .from('transcripts')
    .select('*')
    .eq('recording_id', recordingId)
    .single();

  if (!transcript) {
    throw new Error('Transcript not found');
  }

  // Fetch summary for additional context
  const { data: summary } = await supabaseAdmin
    .from('summaries')
    .select('*')
    .eq('recording_id', recordingId)
    .single();

  // Fetch previous Q&A for context (optional)
  let previousQA: QAResponse[] = [];
  if (includeHistory) {
    const { data: history } = await supabaseAdmin
      .from('qa_history')
      .select('*')
      .eq('recording_id', recordingId)
      .order('created_at', { ascending: false })
      .limit(3);
    previousQA = history || [];
  }

  // Find relevant chunks using keyword search
  const relevantChunks = findRelevantChunks(
    transcript.segments,
    question,
    { maxChunks: 10, minScore: 0.1 }
  );

  // Build context for LLM
  const context = buildQAContext(relevantChunks, summary, previousQA);

  // Generate answer
  const message = await anthropic.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: buildQAPrompt(context, question)
      }
    ]
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  const parsedResponse = parseQAResponse(responseText, relevantChunks);

  // Store in history
  const { data: qaRecord } = await supabaseAdmin
    .from('qa_history')
    .insert({
      recording_id: recordingId,
      question,
      answer: parsedResponse.answer,
      citations: parsedResponse.citations,
      confidence: parsedResponse.confidence,
      llm_provider: 'anthropic',
      llm_model: config.ANTHROPIC_MODEL,
      prompt_tokens: message.usage.input_tokens,
      completion_tokens: message.usage.output_tokens
    })
    .select()
    .single();

  return qaRecord;
}

/**
 * Simple keyword-based retrieval (BM25-style)
 * For v1, this is sufficient. Can upgrade to embeddings later.
 */
function findRelevantChunks(
  segments: TranscriptSegment[],
  question: string,
  options: { maxChunks: number; minScore: number }
): RelevantChunk[] {
  // Extract keywords from question
  const keywords = extractKeywords(question);

  // Score each segment
  const scoredSegments = segments.map(segment => {
    const { score, matchedTerms } = scoreSegment(segment.text, keywords);
    return { segment, score, matchedTerms };
  });

  // Sort by score and filter
  return scoredSegments
    .filter(s => s.score >= options.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxChunks);
}

function extractKeywords(question: string): string[] {
  // Remove stop words and extract meaningful terms
  const stopWords = new Set([
    'what', 'when', 'where', 'who', 'why', 'how', 'the', 'a', 'an',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
    'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'about', 'into', 'through', 'during', 'before', 'after', 'above',
    'below', 'between', 'under', 'again', 'further', 'then', 'once'
  ]);

  return question
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => !stopWords.has(word) && word.length > 2);
}

function scoreSegment(
  text: string,
  keywords: string[]
): { score: number; matchedTerms: string[] } {
  const lowerText = text.toLowerCase();
  const matchedTerms: string[] = [];
  let score = 0;

  for (const keyword of keywords) {
    if (lowerText.includes(keyword)) {
      matchedTerms.push(keyword);
      // Count occurrences
      const regex = new RegExp(keyword, 'gi');
      const matches = lowerText.match(regex);
      score += matches ? matches.length : 0;
    }
  }

  // Normalize by segment length to avoid bias toward longer segments
  const normalizedScore = keywords.length > 0
    ? (score / keywords.length) * (1 / Math.log(text.length + 1))
    : 0;

  return { score: normalizedScore, matchedTerms };
}

function buildQAContext(
  relevantChunks: RelevantChunk[],
  summary: Summary | null,
  previousQA: QAResponse[]
): string {
  let context = '';

  // Add summary context
  if (summary) {
    context += `## Meeting Summary\n${summary.summary}\n\n`;
    context += `## Key Points\n${summary.key_points.map(p => `- ${p}`).join('\n')}\n\n`;
  }

  // Add relevant transcript excerpts
  context += `## Relevant Transcript Excerpts\n\n`;
  for (const chunk of relevantChunks) {
    const timestamp = formatTimestamp(chunk.segment.start_time);
    context += `[${timestamp}] ${chunk.segment.speaker_label}: ${chunk.segment.text}\n\n`;
  }

  // Add previous Q&A for continuity
  if (previousQA.length > 0) {
    context += `## Previous Questions in This Session\n\n`;
    for (const qa of previousQA.reverse()) {
      context += `Q: ${qa.question}\nA: ${qa.answer}\n\n`;
    }
  }

  return context;
}
```

---

## 6. LLM Prompts

### 6.1 Summary Generation Prompt

```typescript
function buildSummaryPrompt(transcriptText: string): string {
  return `You are an expert meeting analyst. Analyze the following meeting transcript and provide a structured summary.

## Transcript

${transcriptText}

## Your Task

Provide a comprehensive analysis of this meeting in JSON format. Be specific and actionable.

## Output Format

Respond with ONLY valid JSON matching this structure:

\`\`\`json
{
  "summary": "A 2-3 paragraph narrative summary of the meeting. Cover the main topics discussed, key decisions made, and overall outcome. Write in past tense.",

  "key_points": [
    "First key point - be specific and actionable",
    "Second key point - include relevant details",
    "Third key point - mention who said what if relevant",
    "... (4-8 key points total)"
  ],

  "action_items": [
    {
      "text": "Specific action to be taken",
      "assignee": "Person's name if mentioned, or null",
      "due_date": "Mentioned deadline like 'by Friday' or 'next week', or null",
      "priority": "high" | "medium" | "low" (infer from context/urgency)
    }
  ],

  "topics": ["topic1", "topic2", "topic3"],

  "sentiment": {
    "overall": "positive" | "neutral" | "negative" | "mixed",
    "score": 0.0 to 1.0 for positive, -1.0 to 0.0 for negative
  }
}
\`\`\`

## Guidelines

1. **Summary**: Write a coherent narrative, not just bullet points. Mention the meeting type if discernible (standup, planning, review, etc.).

2. **Key Points**: Extract the most important information. Each point should stand alone and be understandable without reading the full transcript.

3. **Action Items**: Only include clear commitments or tasks. If no assignee is mentioned, leave as null. Infer priority from:
   - High: Urgent language ("ASAP", "critical", "blocker")
   - Medium: Normal tasks with deadlines
   - Low: Nice-to-haves, future considerations

4. **Topics**: Extract 3-6 main themes discussed.

5. **Sentiment**: Assess the overall tone. Consider:
   - Positive: Progress, achievements, enthusiasm
   - Negative: Problems, frustrations, blockers
   - Mixed: Both positive and negative elements

Respond with ONLY the JSON, no additional text.`;
}
```

### 6.2 Chunk Summary Prompt

```typescript
function buildChunkSummaryPrompt(
  chunkText: string,
  chunkNumber: number,
  totalChunks: number,
  timeRange: string
): string {
  return `You are analyzing part ${chunkNumber} of ${totalChunks} from a meeting transcript.

## Time Range: ${timeRange}

## Transcript Section

${chunkText}

## Your Task

Summarize this section of the meeting. This is part of a longer recording, so focus on:
- What was discussed in this specific section
- Any decisions made
- Any action items mentioned
- Key participants and their contributions

Respond with JSON:

\`\`\`json
{
  "summary": "Brief summary of this section (1 paragraph)",
  "key_points": ["Point 1", "Point 2", ...],
  "action_items": [
    {"text": "...", "assignee": "...", "due_date": "...", "priority": "..."}
  ],
  "topics": ["topic1", "topic2"]
}
\`\`\`

Be concise as this will be merged with other sections.`;
}
```

### 6.3 Merge Summaries Prompt

```typescript
function buildMergeSummaryPrompt(
  combinedSummaries: string,
  speakerCount: number
): string {
  return `You are creating a final summary from multiple section summaries of a long meeting.

## Section Summaries

${combinedSummaries}

## Your Task

Create a unified, coherent summary that:
1. Combines the section summaries into a flowing narrative
2. Deduplicates key points (keep the most important)
3. Consolidates action items (remove duplicates)
4. Identifies overarching themes

Note: This meeting had ${speakerCount} participants.

Respond with JSON:

\`\`\`json
{
  "summary": "Comprehensive 2-3 paragraph summary covering the entire meeting",
  "key_points": ["Deduplicated, prioritized key points (max 8)"],
  "action_items": [
    {"text": "...", "assignee": "...", "due_date": "...", "priority": "..."}
  ],
  "topics": ["Main topics across entire meeting"],
  "sentiment": {
    "overall": "...",
    "score": 0.0
  }
}
\`\`\``;
}
```

### 6.4 Q&A Prompt

```typescript
function buildQAPrompt(context: string, question: string): string {
  return `You are a helpful assistant answering questions about a meeting recording.

## Context

${context}

## Question

${question}

## Instructions

1. Answer the question based ONLY on the provided context
2. If the answer is not in the context, say "I couldn't find information about that in the recording"
3. Be specific and cite timestamps when referencing the transcript
4. Keep your answer concise but complete
5. If the question is ambiguous, address the most likely interpretation

## Response Format

Respond with JSON:

\`\`\`json
{
  "answer": "Your detailed answer here. Reference specific timestamps like [05:23] when citing the transcript.",
  "citations": [
    {
      "timestamp": 323.0,
      "text": "Exact quote from transcript",
      "relevance": "Why this is relevant to the answer"
    }
  ],
  "confidence": 0.0 to 1.0 (how confident you are in the answer)
}
\`\`\`

If you cannot answer from the context, set confidence to 0.0.`;
}
```

### 6.5 Action Item Extraction Prompt (Standalone)

```typescript
function buildActionItemPrompt(transcriptText: string): string {
  return `Extract all action items from this meeting transcript.

## Transcript

${transcriptText}

## Instructions

An action item is a specific task that someone committed to doing. Look for:
- Explicit commitments: "I'll do X", "I can handle that"
- Assignments: "John, can you...?", "Sarah will take care of..."
- Deadlines: "by Friday", "before the next meeting"
- Follow-ups: "Let's circle back", "We need to..."

Do NOT include:
- Vague statements without clear ownership
- Past actions already completed
- Questions without clear answers

## Response Format

\`\`\`json
{
  "action_items": [
    {
      "text": "Clear, specific description of the task",
      "assignee": "Person's name or null if unassigned",
      "due_date": "Mentioned deadline or null",
      "priority": "high" | "medium" | "low",
      "timestamp": "MM:SS when this was discussed",
      "context": "Brief context of why this task is needed"
    }
  ]
}
\`\`\`

Be thorough but avoid false positives. Quality over quantity.`;
}
```

---

## 7. Response Parsing

```typescript
// ============================================================================
// RESPONSE PARSING UTILITIES
// ============================================================================

interface ParsedSummary {
  summary: string;
  key_points: string[];
  action_items: ActionItem[];
  topics: string[];
  sentiment?: Sentiment;
}

function parseSummaryResponse(responseText: string): ParsedSummary {
  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                    responseText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('No valid JSON found in LLM response');
  }

  const jsonString = jsonMatch[1] || jsonMatch[0];

  try {
    const parsed = JSON.parse(jsonString);

    // Validate required fields
    if (!parsed.summary || !Array.isArray(parsed.key_points)) {
      throw new Error('Missing required fields in summary response');
    }

    // Normalize action items
    const actionItems = (parsed.action_items || []).map((item: any) => ({
      text: item.text || '',
      assignee: item.assignee || null,
      due_date: item.due_date || null,
      priority: validatePriority(item.priority)
    }));

    return {
      summary: parsed.summary,
      key_points: parsed.key_points,
      action_items: actionItems,
      topics: parsed.topics || [],
      sentiment: parsed.sentiment ? {
        overall: validateSentiment(parsed.sentiment.overall),
        score: Math.max(-1, Math.min(1, parsed.sentiment.score || 0))
      } : undefined
    };
  } catch (error) {
    console.error('Failed to parse summary response:', error);
    console.error('Response text:', responseText);
    throw new Error(`Failed to parse LLM response: ${error}`);
  }
}

function validatePriority(priority: any): 'high' | 'medium' | 'low' | null {
  if (['high', 'medium', 'low'].includes(priority)) {
    return priority;
  }
  return null;
}

function validateSentiment(sentiment: any): 'positive' | 'neutral' | 'negative' | 'mixed' {
  if (['positive', 'neutral', 'negative', 'mixed'].includes(sentiment)) {
    return sentiment;
  }
  return 'neutral';
}

interface ParsedQAResponse {
  answer: string;
  citations: Citation[];
  confidence: number;
}

function parseQAResponse(
  responseText: string,
  relevantChunks: RelevantChunk[]
): ParsedQAResponse {
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                    responseText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    // Fallback: treat entire response as answer
    return {
      answer: responseText.trim(),
      citations: [],
      confidence: 0.5
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);

    // Map citations to our format
    const citations = (parsed.citations || []).map((c: any) => {
      // Find matching segment
      const matchingChunk = relevantChunks.find(chunk =>
        Math.abs(chunk.segment.start_time - c.timestamp) < 5
      );

      return {
        segment_id: matchingChunk?.segment.id || null,
        timestamp: c.timestamp,
        text: c.text,
        relevance_score: c.relevance ? 1.0 : 0.8
      };
    });

    return {
      answer: parsed.answer || '',
      citations,
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5))
    };
  } catch {
    return {
      answer: responseText.trim(),
      citations: [],
      confidence: 0.5
    };
  }
}
```

---

## 8. Error Handling & Retries

```typescript
// ============================================================================
// ERROR HANDLING
// ============================================================================

class ProcessingError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean = true
  ) {
    super(message);
    this.name = 'ProcessingError';
  }
}

const ERROR_CODES = {
  TRANSCRIPTION_FAILED: { retryable: true, maxRetries: 3 },
  SUMMARIZATION_FAILED: { retryable: true, maxRetries: 3 },
  STORAGE_ERROR: { retryable: true, maxRetries: 3 },
  AUDIO_NOT_FOUND: { retryable: false, maxRetries: 0 },
  INVALID_AUDIO_FORMAT: { retryable: false, maxRetries: 0 },
  RATE_LIMITED: { retryable: true, maxRetries: 5 },
  CONTEXT_TOO_LONG: { retryable: false, maxRetries: 0 },
  UNKNOWN_ERROR: { retryable: true, maxRetries: 2 }
};

async function withRetry<T>(
  fn: () => Promise<T>,
  errorCode: keyof typeof ERROR_CODES,
  currentAttempt: number = 0
): Promise<T> {
  const config = ERROR_CODES[errorCode];

  try {
    return await fn();
  } catch (error) {
    if (!config.retryable || currentAttempt >= config.maxRetries) {
      throw error;
    }

    // Exponential backoff
    const delay = Math.pow(2, currentAttempt) * 1000;
    console.log(`Retrying ${errorCode} in ${delay}ms (attempt ${currentAttempt + 1})`);

    await new Promise(resolve => setTimeout(resolve, delay));
    return withRetry(fn, errorCode, currentAttempt + 1);
  }
}
```

---

*Document version: 1.0*
*Last updated: January 2026*
