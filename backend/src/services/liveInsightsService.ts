/**
 * Live Insights Service
 * Generates AI-powered insights from live meeting transcripts
 */

import Anthropic from '@anthropic-ai/sdk';
import { instrumentAnthropic, withFeature } from '../lib/llm.js';
import { config } from '../config/index.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { languageInstruction } from '../lib/outputLanguage.js';
import { reportAlert } from '../lib/alerts.js';
import { parseModelJsonArray } from '../lib/modelJson.js';
import { LiveInsight, LiveInsightType, VerificationStatus } from '../types/meetings.js';

// Track meetings with pending insight generation to batch requests
const pendingInsightGenerations = new Map<string, NodeJS.Timeout>();
const INSIGHT_BATCH_DELAY_MS = 30000; // Wait 30 seconds to batch transcripts

/**
 * Queue insight generation for a meeting
 * Batches multiple transcript segments together before generating insights
 */
export async function queueInsightGeneration(meetingId: string, userId: string): Promise<void> {
  const key = meetingId;

  // IMPORTANT: this must be a throttle, not a debounce. During an active
  // meeting, final transcript segments arrive continuously (well under the
  // batch delay apart), so resetting the timer on every call means it would
  // never fire until the meeting goes quiet for a full INSIGHT_BATCH_DELAY_MS
  // — which for a live call essentially never happens. If a timer is already
  // pending for this meeting, let it run to completion instead of resetting it.
  if (pendingInsightGenerations.has(key)) {
    return;
  }

  // Set a new timeout to generate insights after the batch delay
  const timeout = setTimeout(async () => {
    pendingInsightGenerations.delete(key);
    try {
      await generateInsightsForMeeting(meetingId, userId);
    } catch (error) {
      console.error(`[LiveInsights] Error generating insights for meeting ${meetingId}:`, error);
    }
  }, INSIGHT_BATCH_DELAY_MS);

  pendingInsightGenerations.set(key, timeout);
}

/**
 * The language live insights are written in: the output_language of the meeting's recording (sent by the client when the
 * recording was created). null = no instruction, i.e. the model default, which is what clients that send none get.
 * Never throws: a language lookup must not block insight generation.
 */
export async function getMeetingOutputLanguage(meetingId: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from('recordings')
      .select('output_language')
      .eq('meeting_id', meetingId)
      .not('output_language', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lang = (data as { output_language?: string | null } | null)?.output_language;
    return typeof lang === 'string' && lang ? lang : null;
  } catch {
    return null;
  }
}

interface InsightRow {
  meeting_id: string;
  user_id: string;
  insight_type: LiveInsightType;
  content: string;
  context: string | null;
  confidence: number | null;
  verification_status: VerificationStatus | null;
  timestamp_seconds: number | null;
}

/**
 * Inserts the rows in one call; if the database rejects the batch (one row failing a constraint rejects all of them),
 * inserts them one at a time so only the bad ones are lost. Any rejection is reported: codes and counts only.
 */
async function storeInsights(meetingId: string, rows: InsightRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error: batchError } = await supabaseAdmin.from('live_insights').insert(rows);
  if (!batchError) {
    console.log(`[LiveInsights] Inserted ${rows.length} insights for meeting ${meetingId}`);
    return;
  }
  console.error('[LiveInsights] Failed to insert insights:', batchError);
  let failed = 0;
  let code = batchError.code;
  for (const row of rows) {
    const { error } = await supabaseAdmin.from('live_insights').insert(row);
    if (error) { failed++; code = error.code; }
  }
  reportAlert('live_insights', failed === rows.length ? 'INSERT_FAILED' : 'INSERT_PARTLY_FAILED', { code, failed, rows: rows.length });
}

type InsightPart = 'key_points' | 'questions' | 'fact_checks' | 'contradictions';

/**
 * The usable items of one model reply. Reports a reply that cannot be read, and items that were unreadable or invalid;
 * a valid empty array is the model saying there is nothing to add and is not reported.
 */
function readReply<T>(part: InsightPart, response: Anthropic.Message, validate: (item: unknown) => T | null): T[] {
  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const parsed = parseModelJsonArray(text);
  if (!parsed.ok) {
    console.error(`[LiveInsights] Unreadable ${part} reply (stop_reason=${response.stop_reason}, ${text.length} chars)`);
    reportAlert('live_insights', 'PARSE_FAILED', { part, stop_reason: response.stop_reason });
    return [];
  }
  const valid = parsed.items.map(validate).filter((v): v is T => v !== null);
  const rejected = parsed.failed + (parsed.items.length - valid.length);
  if (rejected > 0) {
    console.error(`[LiveInsights] Rejected ${rejected} ${part} item(s)`);
    reportAlert('live_insights', 'ITEMS_REJECTED', { part, rejected, kept: valid.length, stop_reason: response.stop_reason });
  }
  return valid;
}

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A key point or question: a string, or an object carrying one under a usual key. */
function textItem(item: unknown): string | null {
  const o = item as Record<string, unknown> | null;
  return nonEmpty(item) ?? nonEmpty(o?.text) ?? nonEmpty(o?.point) ?? nonEmpty(o?.question) ?? nonEmpty(o?.content);
}

/** Statuses the live_insights check constraint accepts. Anything else is stored as 'unknown'. */
const VERIFICATION_STATUSES: readonly string[] = ['verified', 'disputed', 'false', 'unknown'];

function factCheckItem(item: unknown): FactCheckResult | null {
  const o = item as Record<string, unknown> | null;
  const claim = nonEmpty(o?.claim);
  if (!claim) return null;
  const status = String(o?.status ?? '').trim().toLowerCase();
  const confidence = typeof o?.confidence === 'number' && o.confidence >= 0 && o.confidence <= 1 ? o.confidence : undefined;
  return {
    claim,
    status: (VERIFICATION_STATUSES.includes(status) ? status : 'unknown') as FactCheckResult['status'],
    explanation: nonEmpty(o?.explanation) ?? undefined,
    confidence,
  };
}

/**
 * Generate insights for a meeting based on recent transcript segments
 */
export async function generateInsightsForMeeting(meetingId: string, userId: string): Promise<void> {
  if (!config.ANTHROPIC_API_KEY) {
    console.log('[LiveInsights] Anthropic API key not configured, skipping insight generation');
    return;
  }

  // Get recent unprocessed transcript segments (last 30 seconds worth)
  const { data: segments, error: segmentsError } = await supabaseAdmin
    .from('live_transcripts')
    .select('*')
    .eq('meeting_id', meetingId)
    .eq('is_partial', false)
    .eq('shadow', false)
    .order('created_at', { ascending: false })
    .limit(20);

  if (segmentsError) reportAlert('live_insights', 'SEGMENTS_QUERY_FAILED', { code: segmentsError.code });
  if (segmentsError || !segments || segments.length === 0) {
    console.log(`[LiveInsights] No new segments for meeting ${meetingId}`);
    return;
  }

  // Combine segments into context (reverse to chronological order)
  const context = segments
    .reverse()
    .map(s => `[${s.speaker_name || 'Speaker'}]: ${s.segment_text}`)
    .join('\n');

  console.log(`[LiveInsights] Generating insights for ${segments.length} segments in meeting ${meetingId}`);

  const anthropic = instrumentAnthropic(new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }));

  const outputLanguage = await getMeetingOutputLanguage(meetingId);

  // Generate insights in parallel
  const [keyPoints, questions, factChecks] = await Promise.all([
    generateKeyPoints(anthropic, context, outputLanguage),
    generateQuestions(anthropic, context, outputLanguage),
    generateFactChecks(anthropic, context, outputLanguage),
  ]);

  // Calculate approximate timestamp (use the last segment's end time)
  const lastSegment = segments[segments.length - 1];
  const timestampSeconds = lastSegment?.end_timestamp || 0;

  // Store insights
  const insightsToInsert: InsightRow[] = [];

  for (const point of keyPoints) {
    insightsToInsert.push({
      meeting_id: meetingId,
      user_id: userId,
      insight_type: 'key_point',
      content: point,
      context: null,
      confidence: null,
      verification_status: null,
      timestamp_seconds: timestampSeconds,
    });
  }

  for (const question of questions) {
    insightsToInsert.push({
      meeting_id: meetingId,
      user_id: userId,
      insight_type: 'question',
      content: question,
      context: null,
      confidence: null,
      verification_status: null,
      timestamp_seconds: timestampSeconds,
    });
  }

  for (const check of factChecks) {
    insightsToInsert.push({
      meeting_id: meetingId,
      user_id: userId,
      insight_type: 'fact_check',
      content: check.claim,
      context: check.explanation || null,
      confidence: check.confidence ?? null,
      verification_status: check.status as VerificationStatus,
      timestamp_seconds: timestampSeconds,
    });
  }

  await storeInsights(meetingId, insightsToInsert);

  // Check for cross-meeting contradictions asynchronously
  findCrossMeetingContradictions(meetingId, userId, context, timestampSeconds, outputLanguage).catch(err => {
    console.error('[LiveInsights] Error checking cross-meeting contradictions:', err);
  });
}

/**
 * Generate key points from transcript context
 */
async function generateKeyPoints(anthropic: Anthropic, context: string, outputLanguage: string | null = null): Promise<string[]> {
  try {
    const response = await withFeature('live_insights', () => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: `Extract 1-3 key points from this meeting segment. Focus on:
- Decisions made
- Important announcements
- Action items or commitments
- Key insights

Return ONLY a JSON array of strings, no explanation. Example: ["Key point 1", "Key point 2"]
If no key points, return: []` + languageInstruction(outputLanguage),
      messages: [
        {
          role: 'user',
          content: context,
        },
      ],
    }));

    return readReply('key_points', response, textItem);
  } catch (error) {
    console.error('[LiveInsights] Error generating key points:', error);
    return [];
  }
}

/**
 * Generate follow-up questions from transcript context
 */
async function generateQuestions(anthropic: Anthropic, context: string, outputLanguage: string | null = null): Promise<string[]> {
  try {
    const response = await withFeature('live_insights', () => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: `Based on this meeting discussion, suggest 1-2 insightful follow-up questions that could:
- Clarify ambiguous points
- Dig deeper into important topics
- Address potential concerns
- Challenge assumptions

Return ONLY a JSON array of strings, no explanation. Example: ["Question 1?", "Question 2?"]
If no good questions, return: []` + languageInstruction(outputLanguage),
      messages: [
        {
          role: 'user',
          content: context,
        },
      ],
    }));

    return readReply('questions', response, textItem);
  } catch (error) {
    console.error('[LiveInsights] Error generating questions:', error);
    return [];
  }
}

interface FactCheckResult {
  claim: string;
  status: 'verified' | 'disputed' | 'false' | 'unknown';
  explanation?: string;
  confidence?: number;
}

/**
 * Fact-check claims in the transcript
 */
async function generateFactChecks(anthropic: Anthropic, context: string, outputLanguage: string | null = null): Promise<FactCheckResult[]> {
  try {
    const response = await withFeature('live_insights', () => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: `Analyze this meeting segment for factual claims that can be verified. For each verifiable claim:
1. Identify the claim
2. Assess its accuracy (verified, disputed, false, or unknown)
3. Provide brief explanation if disputed or false
4. Confidence score (0.0-1.0)

Only flag claims about:
- Statistics or numbers
- Dates or timelines
- Well-known facts
- Company/product information that seems verifiable

Return ONLY a JSON array, no explanation. Example:
[{"claim": "The claim text", "status": "verified", "confidence": 0.9}]
If no verifiable claims, return: []` + languageInstruction(outputLanguage),
      messages: [
        {
          role: 'user',
          content: context,
        },
      ],
    }));

    return readReply('fact_checks', response, factCheckItem);
  } catch (error) {
    console.error('[LiveInsights] Error generating fact checks:', error);
    return [];
  }
}

/**
 * Find contradictions with previous meetings
 */
async function findCrossMeetingContradictions(
  meetingId: string,
  userId: string,
  currentContext: string,
  timestampSeconds: number,
  outputLanguage: string | null = null
): Promise<void> {
  if (!config.ANTHROPIC_API_KEY) return;

  // Past completed recordings to compare against
  const { data: recordings, error: recordingsError } = await supabaseAdmin
    .from('recordings')
    .select('id, title, created_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(5);

  if (recordingsError || !recordings || recordings.length === 0) {
    return; // No past recordings to compare
  }

  // Get transcripts for these recordings
  const { data: transcripts, error: txError } = await supabaseAdmin
    .from('transcripts')
    .select('recording_id, full_text')
    .in('recording_id', recordings.map(r => r.id));

  if (txError || !transcripts || transcripts.length === 0) {
    return;
  }

  // Combine past transcripts (truncated)
  const pastContext = transcripts
    .map(t => t.full_text?.substring(0, 2000) || '')
    .filter(t => t.length > 0)
    .join('\n---\n')
    .substring(0, 8000);

  if (!pastContext) return;

  const anthropic = instrumentAnthropic(new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }));

  try {
    const response = await withFeature('live_insights', () => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: `Compare the current meeting discussion with past meetings to find:
1. Contradictions (different statements about the same topic)
2. Changed positions or decisions
3. Follow-ups on previous commitments

Return ONLY a JSON array of findings. Example:
[{"type": "contradiction", "current": "current statement", "previous": "previous statement", "explanation": "brief explanation"}]
If nothing notable, return: []` + languageInstruction(outputLanguage),
      messages: [
        {
          role: 'user',
          content: `CURRENT MEETING:\n${currentContext}\n\nPAST MEETINGS:\n${pastContext}`,
        },
      ],
    }));

    const findings = readReply('contradictions', response, (item) =>
      item && typeof item === 'object' ? (item as Record<string, unknown>) : null);

    await storeInsights(meetingId, findings
      .filter((f) => f.type === 'contradiction' || f.type === 'changed_position')
      .map((f) => ({
        meeting_id: meetingId,
        user_id: userId,
        insight_type: 'contradiction' as const,
        content: nonEmpty(f.explanation) ?? `Current: "${f.current}" vs Previous: "${f.previous}"`,
        context: nonEmpty(f.current),
        confidence: null,
        verification_status: null,
        timestamp_seconds: timestampSeconds,
      })));
  } catch (error) {
    console.error('[LiveInsights] Error finding contradictions:', error);
  }
}

/**
 * Get live insights for a meeting
 */
export async function getLiveInsights(
  meetingId: string,
  userId: string,
  type?: LiveInsightType
): Promise<LiveInsight[]> {
  let query = supabaseAdmin
    .from('live_insights')
    .select('*')
    .eq('meeting_id', meetingId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (type) {
    query = query.eq('insight_type', type);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[LiveInsights] Error fetching insights:', error);
    return [];
  }

  return data || [];
}
