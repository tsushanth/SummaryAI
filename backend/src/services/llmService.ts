/**
 * LLM Service
 * Handles interactions with the Anthropic Claude API for Q&A and summarization
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import type { TranscriptSegment } from '../types/database.js';
import type { Citation } from '../types/api.js';

// ============================================================================
// Types
// ============================================================================

export interface QAResult {
  answer: string;
  citations: Citation[];
  confidence: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface RelevantSegment {
  segment: TranscriptSegment;
  score: number;
  matchedTerms: string[];
}

// ============================================================================
// LLM Client
// ============================================================================

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: config.ANTHROPIC_API_KEY,
    });
  }

  return anthropicClient;
}

// ============================================================================
// Q&A Prompt Template
// ============================================================================

const QA_SYSTEM_PROMPT = `You are a helpful assistant that answers questions about meeting recordings based solely on the provided transcript.

Your responsibilities:
1. Answer questions accurately based ONLY on the transcript content
2. If the information is not in the transcript, clearly state that
3. Cite specific parts of the transcript to support your answers
4. Be concise but thorough

Important rules:
- Never make up information not present in the transcript
- If asked about something not discussed, say "This was not discussed in the recording"
- Always provide timestamps when referencing specific parts
- Maintain a helpful, professional tone`;

function buildQAPrompt(
  question: string,
  relevantSegments: RelevantSegment[],
  previousQA?: Array<{ question: string; answer: string }>
): string {
  let prompt = `## Transcript Excerpts\n\n`;

  // Add relevant transcript segments
  for (const { segment } of relevantSegments) {
    const timestamp = formatTimestamp(segment.start_time);
    prompt += `[${timestamp}] ${segment.speaker_label}: ${segment.text}\n\n`;
  }

  // Add previous Q&A context if available
  if (previousQA && previousQA.length > 0) {
    prompt += `\n## Previous Questions in This Session\n\n`;
    for (const qa of previousQA) {
      prompt += `Q: ${qa.question}\nA: ${qa.answer}\n\n`;
    }
  }

  // Add the current question
  prompt += `\n## Current Question\n\n${question}\n\n`;

  // Add response format instructions
  prompt += `## Instructions

Answer the question based on the transcript excerpts above. Your response must be valid JSON with this structure:

\`\`\`json
{
  "answer": "Your detailed answer here. Reference specific timestamps like [MM:SS] when citing the transcript.",
  "citations": [
    {
      "segment_id": "the segment id",
      "timestamp": timestamp_in_seconds,
      "text": "exact quote from transcript",
      "speaker": "Speaker label"
    }
  ],
  "confidence": 0.0 to 1.0
}
\`\`\`

Guidelines:
- Set confidence to 0.9+ if the answer is clearly supported by the transcript
- Set confidence to 0.5-0.8 if the answer requires some inference
- Set confidence below 0.5 if you're uncertain or the information is not in the transcript
- Include 1-3 relevant citations that support your answer
- Keep the answer concise but complete`;

  return prompt;
}

// ============================================================================
// Transcript Retrieval (Simple Keyword-Based)
// ============================================================================

/**
 * Find relevant transcript segments based on keyword matching
 * This is a simple BM25-style approach for v1
 */
export function findRelevantSegments(
  segments: TranscriptSegment[],
  question: string,
  maxSegments: number = config.QA_MAX_RELEVANT_SEGMENTS
): RelevantSegment[] {
  // Extract keywords from the question
  const keywords = extractKeywords(question);

  if (keywords.length === 0) {
    // If no keywords, return first N segments as context
    return segments.slice(0, maxSegments).map((segment) => ({
      segment,
      score: 0.5,
      matchedTerms: [],
    }));
  }

  // Score each segment
  const scoredSegments: RelevantSegment[] = segments.map((segment) => {
    const { score, matchedTerms } = scoreSegment(segment.text, keywords);
    return { segment, score, matchedTerms };
  });

  // Sort by score and take top N
  return scoredSegments
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSegments);
}

/**
 * Extract meaningful keywords from a question
 */
function extractKeywords(question: string): string[] {
  const stopWords = new Set([
    'what', 'when', 'where', 'who', 'why', 'how', 'which', 'whom', 'whose',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
    'from', 'about', 'into', 'through', 'during', 'before', 'after',
    'above', 'below', 'between', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'all', 'each', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
    'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or',
    'because', 'as', 'until', 'while', 'any', 'both', 'this', 'that',
    'these', 'those', 'it', 'its', 'they', 'them', 'their', 'he', 'she',
    'him', 'her', 'his', 'hers', 'we', 'us', 'our', 'you', 'your', 'me', 'my',
    'tell', 'said', 'say', 'discuss', 'discussed', 'mentioned', 'talk', 'talked',
  ]);

  return question
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 10); // Limit to 10 keywords
}

/**
 * Score a segment based on keyword matches
 */
function scoreSegment(
  text: string,
  keywords: string[]
): { score: number; matchedTerms: string[] } {
  const lowerText = text.toLowerCase();
  const matchedTerms: string[] = [];
  let score = 0;

  for (const keyword of keywords) {
    // Check for exact word match
    const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'gi');
    const matches = lowerText.match(wordBoundaryRegex);

    if (matches) {
      matchedTerms.push(keyword);
      // Score based on match count, with diminishing returns
      score += Math.log(1 + matches.length);
    } else if (lowerText.includes(keyword)) {
      // Partial match (substring) gets lower score
      matchedTerms.push(keyword);
      score += 0.5;
    }
  }

  // Normalize by number of keywords and text length
  const normalizedScore = keywords.length > 0
    ? (score / keywords.length) * (100 / Math.log(text.length + 100))
    : 0;

  return { score: normalizedScore, matchedTerms };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate segments to fit within token limit
 */
export function truncateToTokenLimit(
  segments: RelevantSegment[],
  maxTokens: number
): RelevantSegment[] {
  const result: RelevantSegment[] = [];
  let totalTokens = 0;

  for (const segment of segments) {
    const segmentText = `[${formatTimestamp(segment.segment.start_time)}] ${segment.segment.speaker_label}: ${segment.segment.text}\n\n`;
    const segmentTokens = estimateTokens(segmentText);

    if (totalTokens + segmentTokens > maxTokens) {
      break;
    }

    result.push(segment);
    totalTokens += segmentTokens;
  }

  return result;
}

// ============================================================================
// Main Q&A Function
// ============================================================================

/**
 * Answer a question about a recording based on its transcript
 */
export async function answerQuestion(
  question: string,
  segments: TranscriptSegment[],
  options: {
    previousQA?: Array<{ question: string; answer: string }>;
    maxTokens?: number;
  } = {}
): Promise<QAResult> {
  const client = getAnthropicClient();

  // Find relevant segments
  let relevantSegments = findRelevantSegments(segments, question);

  // If no relevant segments found, use a sample of the transcript
  if (relevantSegments.length === 0) {
    relevantSegments = segments.slice(0, 10).map((segment) => ({
      segment,
      score: 0.3,
      matchedTerms: [],
    }));
  }

  // Truncate to fit token limit
  const maxContextTokens = options.maxTokens || config.QA_MAX_CONTEXT_TOKENS;
  relevantSegments = truncateToTokenLimit(relevantSegments, maxContextTokens);

  // Build the prompt
  const userPrompt = buildQAPrompt(question, relevantSegments, options.previousQA);

  // Call the LLM
  const response = await client.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: config.ANTHROPIC_MAX_TOKENS,
    system: QA_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });

  // Parse the response
  const responseText = response.content[0]?.type === 'text'
    ? response.content[0].text
    : '';

  const parsedResult = parseQAResponse(responseText, relevantSegments);

  return {
    ...parsedResult,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

/**
 * Parse the LLM's JSON response
 */
function parseQAResponse(
  responseText: string,
  relevantSegments: RelevantSegment[]
): Omit<QAResult, 'usage'> {
  // Try to extract JSON from the response
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    responseText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    // Fallback: treat the entire response as the answer
    return {
      answer: responseText.trim(),
      citations: [],
      confidence: 0.5,
    };
  }

  try {
    const jsonString = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonString);

    // Validate and sanitize citations
    const citations: Citation[] = (parsed.citations || [])
      .filter((c: unknown): c is Record<string, unknown> =>
        typeof c === 'object' && c !== null
      )
      .map((c: Record<string, unknown>) => {
        // Try to find matching segment for the citation
        const matchingSegment = relevantSegments.find((rs) => {
          if (c.segment_id === rs.segment.id) return true;
          if (typeof c.timestamp === 'number') {
            return Math.abs(rs.segment.start_time - c.timestamp) < 5;
          }
          return false;
        });

        return {
          segment_id: matchingSegment?.segment.id || String(c.segment_id || ''),
          timestamp: typeof c.timestamp === 'number' ? c.timestamp : (matchingSegment?.segment.start_time || 0),
          text: String(c.text || ''),
          speaker: String(c.speaker || matchingSegment?.segment.speaker_label || 'Unknown'),
        };
      })
      .slice(0, 5); // Limit to 5 citations

    return {
      answer: String(parsed.answer || responseText),
      citations,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
    };
  } catch {
    // JSON parsing failed, use response as answer
    return {
      answer: responseText.trim(),
      citations: [],
      confidence: 0.5,
    };
  }
}

// ============================================================================
// Utilities
// ============================================================================

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ============================================================================
// Mock Implementation (for testing without API key)
// ============================================================================

/**
 * Mock Q&A for development/testing when no API key is available
 */
export async function answerQuestionMock(
  question: string,
  segments: TranscriptSegment[]
): Promise<QAResult> {
  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Find relevant segments
  const relevantSegments = findRelevantSegments(segments, question, 3);

  // Create a mock answer based on the segments
  let answer: string;
  const citations: Citation[] = [];

  if (relevantSegments.length > 0) {
    const topSegment = relevantSegments[0]!.segment;
    answer = `Based on the transcript, here's what I found related to your question:\n\n`;
    answer += `At ${formatTimestamp(topSegment.start_time)}, ${topSegment.speaker_label} mentioned: "${topSegment.text.substring(0, 200)}..."`;

    citations.push({
      segment_id: topSegment.id,
      timestamp: topSegment.start_time,
      text: topSegment.text.substring(0, 100),
      speaker: topSegment.speaker_label,
    });
  } else {
    answer = `I couldn't find specific information about "${question}" in this recording. The transcript may not contain relevant discussions about this topic.`;
  }

  return {
    answer,
    citations,
    confidence: relevantSegments.length > 0 ? 0.7 : 0.3,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
}
