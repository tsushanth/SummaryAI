/**
 * Processing service
 * Handles async processing of recordings (transcription + summarization)
 */

import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import { dispatchRecordingCompleted } from './integrationsService.js';
import { instrumentAnthropic, withFeature } from '../lib/llm.js';
import { normalizeActionItems, type ParsedSummary } from './summaryService.js';
import { generateSummary, type CompleteFn } from './summaryGeneration.js';
import { resolveSummaryTemplate } from './summaryTemplates.js';

export interface ProcessingJob {
  id: string;
  recording_id: string;
  user_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  created_at: Date;
}

interface TranscriptSegment {
  id: string;
  speaker_label: string;
  speaker_index: number;
  text: string;
  start_time: number;
  end_time: number;
  confidence: number;
}

interface TranscriptionResult {
  segments: TranscriptSegment[];
  fullText: string;
  wordCount: number;
  speakerCount: number;
  detectedLanguage: string;
}

/**
 * Trigger async processing for a recording
 */
export async function triggerProcessing(
  recordingId: string,
  userId: string
): Promise<ProcessingJob> {
  const jobId = uuidv4();

  console.log(`[Processing] Triggering job ${jobId} for recording ${recordingId}`);

  // Run processing in the background without blocking the response
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
 * Process recording: transcribe and summarize
 */
async function processRecordingAsync(
  recordingId: string,
  userId: string,
  jobId: string
): Promise<void> {
  console.log(`[Processing] Starting job ${jobId}`);

  try {
    // Get recording details
    const { data: recording, error: recordingError } = await supabaseAdmin
      .from('recordings')
      .select('*')
      .eq('id', recordingId)
      .single();

    if (recordingError || !recording) {
      throw new Error('Recording not found');
    }

    // Check if this is a PDF (imported document)
    const isPdf = recording.content_type === 'application/pdf' || recording.file_path?.endsWith('.pdf');

    // Step 1: Update status to transcribing
    await updateStatus(recordingId, 'transcribing');
    console.log(`[Processing] ${jobId}: Status -> transcribing (isPdf: ${isPdf})`);

    // Step 2: Download file from storage
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from(config.STORAGE_BUCKET_AUDIO)
      .download(recording.file_path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message}`);
    }

    console.log(`[Processing] ${jobId}: Downloaded file (${fileData.size} bytes)`);

    // Step 3: Process based on file type
    let transcript: TranscriptionResult;

    if (isPdf) {
      // Extract text from PDF
      transcript = await extractTextFromPdf(fileData);
      console.log(`[Processing] ${jobId}: PDF text extraction complete (${transcript.wordCount} words)`);
    } else if (config.DEEPGRAM_API_KEY) {
      transcript = await transcribeWithDeepgram(fileData, recording.file_path);
    } else {
      console.warn(`[Processing] ${jobId}: No Deepgram API key, using mock transcription`);
      transcript = createMockTranscript(recording.duration_seconds || 60);
    }

    console.log(`[Processing] ${jobId}: Transcription complete (${transcript.wordCount} words, ${transcript.speakerCount} speakers, language: ${transcript.detectedLanguage})`);

    // Step 4: Store transcript in database
    const { error: transcriptError } = await supabaseAdmin
      .from('transcripts')
      .insert({
        id: uuidv4(),
        recording_id: recordingId,
        full_text: transcript.fullText,
        segments: transcript.segments,
        word_count: transcript.wordCount,
        speaker_count: transcript.speakerCount,
        language: transcript.detectedLanguage,
        transcription_provider: config.DEEPGRAM_API_KEY ? 'deepgram' : 'mock',
        transcription_model: config.DEEPGRAM_API_KEY ? 'nova-2' : 'mock',
      });

    if (transcriptError) {
      throw new Error(`Failed to store transcript: ${transcriptError.message}`);
    }

    // Step 5: Update status to transcribed
    await updateStatus(recordingId, 'transcribed');
    console.log(`[Processing] ${jobId}: Status -> transcribed`);

    // Step 6: Update status to summarizing
    await updateStatus(recordingId, 'summarizing');
    console.log(`[Processing] ${jobId}: Status -> summarizing`);

    // Step 7: Generate summary with Anthropic (or mock if no API key)
    let summary: ParsedSummary;

    if (config.ANTHROPIC_API_KEY) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('preferences')
        .eq('id', userId)
        .maybeSingle();
      summary = await generateSummaryWithAnthropic(
        transcript.fullText,
        transcript.segments,
        recording.output_language,
        resolveSummaryTemplate({
          recordingTemplate: recording.summary_template,
          userDefault: profile?.preferences?.default_summary_template,
          recordingType: recording.recording_type,
        }),
        recordingId
      );
    } else {
      console.warn(`[Processing] ${jobId}: No Anthropic API key, using mock summary`);
      summary = createMockSummary(transcript.fullText);
    }

    console.log(`[Processing] ${jobId}: Summary generated`);

    // Step 8: Store summary in database
    const summaryRow = {
      id: uuidv4(),
      recording_id: recordingId,
      summary: summary.summary,
      detailed_summary: summary.detailedSummary,
      key_points: summary.keyPoints,
      action_items: summary.actionItems,
      topics: summary.topics,
      llm_provider: config.ANTHROPIC_API_KEY ? 'anthropic' : 'mock',
      llm_model: config.ANTHROPIC_API_KEY ? config.ANTHROPIC_MODEL : 'mock',
    };
    let { error: summaryError } = await supabaseAdmin.from('summaries').insert(summaryRow);
    if (summaryError && /detailed_summary/.test(summaryError.message)) {
      // Migration 021 not applied yet: store everything else rather than fail the whole recording.
      const { detailed_summary: _omit, ...withoutDetailed } = summaryRow;
      ({ error: summaryError } = await supabaseAdmin.from('summaries').insert(withoutDetailed));
    }

    if (summaryError) {
      throw new Error(`Failed to store summary: ${summaryError.message}`);
    }

    // Step 9: Mark as completed
    const { error: completionError } = await supabaseAdmin
      .from('recordings')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        speaker_count: transcript.speakerCount,
        word_count: transcript.wordCount,
        language: transcript.detectedLanguage,
      })
      .eq('id', recordingId);

    if (completionError) {
      console.error(`[Processing] ${jobId}: Failed to mark as completed:`, completionError);
      throw new Error(`Failed to update recording status: ${completionError.message}`);
    }

    console.log(`[Processing] ${jobId}: Completed successfully, status updated to 'completed'`);

    // Fire-and-forget: integration failures must never affect processing.
    void dispatchRecordingCompleted(recordingId);

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

/**
 * Transcribe audio using Deepgram API
 */
async function transcribeWithDeepgram(
  audioData: Blob,
  filePath: string
): Promise<TranscriptionResult> {
  const arrayBuffer = await audioData.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Determine content type from file extension
  const ext = filePath.split('.').pop()?.toLowerCase() || 'm4a';
  const contentType = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';

  // Call Deepgram API with detect_language enabled for auto-detection
  const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&paragraphs=true&utterances=true&detect_language=true', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${config.DEEPGRAM_API_KEY}`,
      'Content-Type': contentType,
    },
    body: buffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Deepgram API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json() as any;

  // Extract detected language from Deepgram response
  const detectedLanguage = result.results?.channels?.[0]?.detected_language || 'en';

  // Extract utterances/paragraphs as segments
  const utterances = result.results?.utterances || [];
  const segments: TranscriptSegment[] = utterances.map((u: any, index: number) => ({
    id: uuidv4(),
    speaker_label: `Speaker ${u.speaker || 0}`,
    speaker_index: u.speaker || 0,
    text: u.transcript || '',
    start_time: u.start || 0,
    end_time: u.end || 0,
    confidence: u.confidence || 0.9,
  }));

  // Extract full transcript
  const fullText = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

  // Count words
  const wordCount = fullText.split(/\s+/).filter((w: string) => w.length > 0).length;

  // Count unique speakers
  const speakers = new Set(segments.map((s: TranscriptSegment) => s.speaker_index));
  const speakerCount = Math.max(1, speakers.size);

  return { segments, fullText, wordCount, speakerCount, detectedLanguage };
}

/**
 * Extract text from PDF using pdf-parse or Anthropic Claude
 */
async function extractTextFromPdf(
  pdfData: Blob
): Promise<TranscriptionResult> {
  try {
    const arrayBuffer = await pdfData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Try to use pdf-parse if available, otherwise use Anthropic Claude
    let fullText = '';

    try {
      // Dynamic import of pdf-parse (optional dependency)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfParseModule = (await import('pdf-parse')) as any;
      const pdfParse = pdfParseModule.default || pdfParseModule;
      const data = await pdfParse(buffer);
      fullText = data.text || '';
    } catch {
      // Fallback: Use Anthropic to extract text from PDF
      if (config.ANTHROPIC_API_KEY) {
        const anthropic = instrumentAnthropic(new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }));

        // Convert PDF to base64
        const base64 = buffer.toString('base64');

        const response = await withFeature('pdf_extract', () => anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: base64,
                  },
                },
                {
                  type: 'text',
                  text: 'Extract and return all the text content from this PDF document. Return only the extracted text, no additional commentary.',
                },
              ],
            },
          ],
        }));

        fullText = response.content[0]?.type === 'text' ? response.content[0].text : '';
      } else {
        fullText = 'PDF text extraction failed - no pdf-parse library or Anthropic API key available.';
      }
    }

    // Clean up the text
    fullText = fullText.trim();

    // Create segments from paragraphs
    const paragraphs = fullText.split(/\n\n+/).filter(p => p.trim().length > 0);
    const segments: TranscriptSegment[] = paragraphs.map((text, index) => ({
      id: `seg-${index}`,
      speaker_label: 'Document',
      speaker_index: 0,
      text: text.trim(),
      start_time: 0,
      end_time: 0,
      confidence: 1.0,
    }));

    // Count words
    const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;

    return {
      segments,
      fullText,
      wordCount,
      speakerCount: 0, // PDFs don't have speakers
      detectedLanguage: 'en', // PDFs default to English, could be enhanced with language detection
    };
  } catch (error) {
    console.error('PDF extraction error:', error);
    return {
      segments: [],
      fullText: 'Failed to extract text from PDF.',
      wordCount: 0,
      speakerCount: 0,
      detectedLanguage: 'en',
    };
  }
}

/**
 * Format transcript with speaker labels for better context
 */
function formatSpeakerTurns(segments: TranscriptSegment[]): string[] {
  return segments.map(segment => {
    const timestamp = formatTimestamp(segment.start_time);
    return `[${timestamp}] ${segment.speaker_label}: ${segment.text}`;
  });
}

/**
 * Format seconds to MM:SS timestamp
 */
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Map a BCP-47 language code (or display name) to a human-readable language name
 * for prompting. Returns null for unrecognized / "auto" / empty values.
 */
function languageNameForCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = code.trim().toLowerCase();
  if (!normalized || normalized === 'auto') return null;
  const base = normalized.split(/[-_]/)[0];
  const map: Record<string, string> = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    pt: 'Portuguese',
    it: 'Italian',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
    hi: 'Hindi',
    ar: 'Arabic',
    ru: 'Russian',
    nl: 'Dutch',
    pl: 'Polish',
    tr: 'Turkish',
  };
  return base ? (map[base] ?? null) : null;
}

/**
 * Generate summary using Anthropic API
 */
export async function generateSummaryWithAnthropic(
  fullText: string,
  segments: TranscriptSegment[],
  outputLanguage?: string | null,
  templateId?: string | null,
  recordingId?: string | null
): Promise<ParsedSummary> {
  const anthropic = instrumentAnthropic(new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }));

  // Speaker-labelled turns. Up to 100k characters this is one call; longer transcripts are summarised in
  // chunks (never truncated), see summaryGeneration.ts.
  const turns = formatSpeakerTurns(segments);

  // Get unique speakers for the prompt
  const uniqueSpeakers = [...new Set(segments.map(s => s.speaker_label))];

  // One literal feature label per call site (the llm-usage source guard checks them).
  const complete: CompleteFn = async ({ kind, system, user, maxTokens }) => {
    const params = {
      model: config.ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user' as const, content: user }],
    };
    const response =
      kind === 'chunk'
        ? await withFeature('summary_chunk', () => anthropic.messages.create(params))
        : kind === 'merge'
          ? await withFeature('summary_merge', () => anthropic.messages.create(params))
          : await withFeature('summary', () => anthropic.messages.create(params));
    return {
      text: response.content[0]?.type === 'text' ? response.content[0].text : '',
      stopReason: response.stop_reason,
    };
  };

  return generateSummary({
    turns,
    speakers: uniqueSpeakers,
    templateId,
    languageName: languageNameForCode(outputLanguage),
    complete,
    recordingId,
    model: config.ANTHROPIC_MODEL,
  });
}

/**
 * Create mock transcript for testing without Deepgram
 */
function createMockTranscript(durationSeconds: number): TranscriptionResult {
  const segmentCount = Math.max(3, Math.floor(durationSeconds / 10));
  const segments: TranscriptSegment[] = [];

  const sampleTexts = [
    "Hello everyone, thanks for joining today's meeting.",
    "Let me share my screen and walk you through the agenda.",
    "We need to discuss the quarterly targets and our progress so far.",
    "The key metrics are looking positive, but we have some areas to improve.",
    "I'd like to get everyone's input on the next steps.",
    "Great point. Let's add that to our action items.",
    "Can we schedule a follow-up meeting for next week?",
    "Thanks everyone for your time today.",
  ];

  for (let i = 0; i < segmentCount; i++) {
    const startTime = (i * durationSeconds) / segmentCount;
    const endTime = ((i + 1) * durationSeconds) / segmentCount;
    const speakerIndex = i % 2;

    segments.push({
      id: uuidv4(),
      speaker_label: `Speaker ${speakerIndex + 1}`,
      speaker_index: speakerIndex,
      text: sampleTexts[i % sampleTexts.length] || 'Sample text.',
      start_time: startTime,
      end_time: endTime,
      confidence: 0.95,
    });
  }

  const fullText = segments.map((s) => s.text).join(' ');
  const wordCount = fullText.split(/\s+/).length;

  return {
    segments,
    fullText,
    wordCount,
    speakerCount: 2,
    detectedLanguage: 'en',
  };
}

/**
 * Create mock summary for testing without Anthropic
 */
function createMockSummary(fullText: string): ParsedSummary {
  return {
    summary: 'This is a mock summary of the recording. The participants discussed various topics and made progress on key items. Several action items were identified for follow-up.',
    detailedSummary: null,
    keyPoints: [
      'Team discussed quarterly progress and targets',
      'Key metrics are trending positively',
      'Action items were identified for improvement areas',
      'Follow-up meeting scheduled',
    ],
    actionItems: normalizeActionItems([
      { task: 'Review quarterly metrics report', assignee: null, priority: 'high' },
      { task: 'Schedule follow-up meeting', assignee: null, priority: 'medium' },
    ]),
    topics: ['Quarterly Review', 'Metrics', 'Action Items'],
  };
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
