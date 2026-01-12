/**
 * Live Insights Service
 * Generates AI-powered insights from live meeting transcripts
 */

import OpenAI from 'openai';
import { config } from '../config/index.js';
import { supabaseAdmin } from '../lib/supabase.js';
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

  // Clear existing timeout to reset the batch window
  if (pendingInsightGenerations.has(key)) {
    clearTimeout(pendingInsightGenerations.get(key)!);
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
 * Generate insights for a meeting based on recent transcript segments
 */
async function generateInsightsForMeeting(meetingId: string, userId: string): Promise<void> {
  if (!config.OPENAI_API_KEY) {
    console.log('[LiveInsights] OpenAI API key not configured, skipping insight generation');
    return;
  }

  // Get recent unprocessed transcript segments (last 30 seconds worth)
  const { data: segments, error: segmentsError } = await supabaseAdmin
    .from('live_transcripts')
    .select('*')
    .eq('meeting_id', meetingId)
    .eq('is_partial', false)
    .order('created_at', { ascending: false })
    .limit(20);

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

  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  // Generate insights in parallel
  const [keyPoints, questions, factChecks] = await Promise.all([
    generateKeyPoints(openai, context),
    generateQuestions(openai, context),
    generateFactChecks(openai, context),
  ]);

  // Calculate approximate timestamp (use the last segment's end time)
  const lastSegment = segments[segments.length - 1];
  const timestampSeconds = lastSegment?.end_timestamp || 0;

  // Store insights
  const insightsToInsert: Array<{
    meeting_id: string;
    user_id: string;
    insight_type: LiveInsightType;
    content: string;
    context: string | null;
    confidence: number | null;
    verification_status: VerificationStatus | null;
    timestamp_seconds: number | null;
  }> = [];

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
      confidence: check.confidence || null,
      verification_status: check.status as VerificationStatus,
      timestamp_seconds: timestampSeconds,
    });
  }

  if (insightsToInsert.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from('live_insights')
      .insert(insightsToInsert);

    if (insertError) {
      console.error('[LiveInsights] Failed to insert insights:', insertError);
    } else {
      console.log(`[LiveInsights] Inserted ${insightsToInsert.length} insights for meeting ${meetingId}`);
    }
  }

  // Check for cross-meeting contradictions asynchronously
  findCrossMeetingContradictions(meetingId, userId, context, timestampSeconds).catch(err => {
    console.error('[LiveInsights] Error checking cross-meeting contradictions:', err);
  });
}

/**
 * Generate key points from transcript context
 */
async function generateKeyPoints(openai: OpenAI, context: string): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: `Extract 1-3 key points from this meeting segment. Focus on:
- Decisions made
- Important announcements
- Action items or commitments
- Key insights

Return ONLY a JSON array of strings, no explanation. Example: ["Key point 1", "Key point 2"]
If no key points, return: []`,
        },
        {
          role: 'user',
          content: context,
        },
      ],
    });

    const content = response.choices[0]?.message?.content || '[]';
    return JSON.parse(content);
  } catch (error) {
    console.error('[LiveInsights] Error generating key points:', error);
    return [];
  }
}

/**
 * Generate follow-up questions from transcript context
 */
async function generateQuestions(openai: OpenAI, context: string): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: `Based on this meeting discussion, suggest 1-2 insightful follow-up questions that could:
- Clarify ambiguous points
- Dig deeper into important topics
- Address potential concerns
- Challenge assumptions

Return ONLY a JSON array of strings, no explanation. Example: ["Question 1?", "Question 2?"]
If no good questions, return: []`,
        },
        {
          role: 'user',
          content: context,
        },
      ],
    });

    const content = response.choices[0]?.message?.content || '[]';
    return JSON.parse(content);
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
async function generateFactChecks(openai: OpenAI, context: string): Promise<FactCheckResult[]> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 800,
      messages: [
        {
          role: 'system',
          content: `Analyze this meeting segment for factual claims that can be verified. For each verifiable claim:
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
If no verifiable claims, return: []`,
        },
        {
          role: 'user',
          content: context,
        },
      ],
    });

    const content = response.choices[0]?.message?.content || '[]';
    return JSON.parse(content);
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
  timestampSeconds: number
): Promise<void> {
  if (!config.OPENAI_API_KEY) return;

  // Get past transcripts for comparison (from completed recordings)
  const { data: pastTranscripts, error: transcriptsError } = await supabaseAdmin
    .from('transcripts')
    .select('recording_id, full_text')
    .eq('recording_id', supabaseAdmin.rpc('get_user_recording_ids', { p_user_id: userId }))
    .order('created_at', { ascending: false })
    .limit(5);

  // If no past transcripts or error, try getting from recordings directly
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

  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content: `Compare the current meeting discussion with past meetings to find:
1. Contradictions (different statements about the same topic)
2. Changed positions or decisions
3. Follow-ups on previous commitments

Return ONLY a JSON array of findings. Example:
[{"type": "contradiction", "current": "current statement", "previous": "previous statement", "explanation": "brief explanation"}]
If nothing notable, return: []`,
        },
        {
          role: 'user',
          content: `CURRENT MEETING:\n${currentContext}\n\nPAST MEETINGS:\n${pastContext}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content || '[]';
    const findings = JSON.parse(content);

    // Insert contradiction insights
    for (const finding of findings) {
      if (finding.type === 'contradiction' || finding.type === 'changed_position') {
        await supabaseAdmin.from('live_insights').insert({
          meeting_id: meetingId,
          user_id: userId,
          insight_type: 'contradiction',
          content: finding.explanation || `Current: "${finding.current}" vs Previous: "${finding.previous}"`,
          context: finding.current,
          timestamp_seconds: timestampSeconds,
        });
      }
    }
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
