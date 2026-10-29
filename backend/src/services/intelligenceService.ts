/**
 * Intelligence service: LLM-backed helpers for regenerate-summary, follow-up email and
 * cross-meeting chat. `completeText` is the only function that touches the network, so tests
 * mock this module's `completeText`.
 */

import Anthropic from '@anthropic-ai/sdk';
import { instrumentAnthropic, withFeature } from '../lib/llm.js';
import { config } from '../config/index.js';

let client: Anthropic | null = null;

export async function completeText(opts: {
  feature: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** Overrides config.ANTHROPIC_MODEL (used by summary regeneration). */
  model?: string;
}): Promise<string> {
  if (!config.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');
  if (!client) client = instrumentAnthropic(new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }));
  const anthropic = client;
  // One literal label so the llm-usage source guard can verify it; callers pass a sub-feature for logs only.
  const response = await withFeature('intelligence', () => anthropic.messages.create({
    model: opts.model ?? config.ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  }));
  return response.content[0]?.type === 'text' ? response.content[0].text : '';
}

export function extractJson(text: string): any | null {
  try {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
    return JSON.parse(m?.[1] || m?.[0] || text);
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Transcript formatting
// ----------------------------------------------------------------------------

export interface SegmentLike {
  speaker_label?: string;
  start_time?: number;
  text?: string;
}

function ts(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/** One "[m:ss] Name: text" entry per speaker turn. */
export function segmentTurns(segments: SegmentLike[]): string[] {
  return segments.map((s) => `[${ts(s.start_time ?? 0)}] ${s.speaker_label ?? 'Speaker'}: ${s.text ?? ''}`);
}

export function formatSegments(segments: SegmentLike[] | null | undefined, fullText: string, maxChars = 100000): string {
  const text =
    Array.isArray(segments) && segments.length > 0
      ? segmentTurns(segments).join('\n\n')
      : fullText;
  return text.length > maxChars ? text.slice(0, maxChars) + '...' : text;
}

// ----------------------------------------------------------------------------
// Follow-up email
// ----------------------------------------------------------------------------

export interface EmailDraft {
  subject: string;
  body: string;
}

export function buildFollowUpPrompt(opts: {
  title: string;
  summary: string;
  keyPoints: string[];
  actionItems: { task: string; assignee: string | null; due_date: string | null }[];
  tone?: string;
  recipient?: string;
}): { system: string; user: string } {
  const actions = opts.actionItems.length
    ? opts.actionItems
        .map((a) => `- ${a.task}${a.assignee ? ` (owner: ${a.assignee})` : ''}${a.due_date ? ` (due: ${a.due_date})` : ''}`)
        .join('\n')
    : '- none recorded';
  const user = `Write a follow-up email after this meeting.
Meeting: ${opts.title}
Tone: ${opts.tone || 'professional and friendly'}
${opts.recipient ? `Recipient: ${opts.recipient}\n` : ''}
Summary:
${opts.summary}

Key points:
${opts.keyPoints.map((k) => `- ${k}`).join('\n') || '- none'}

Action items:
${actions}

Rules: plain text only (no markdown), use only facts above, do not invent dates or commitments, keep it under 200 words, end with a short sign-off without a name.
Respond with ONLY valid JSON: {"subject": "...", "body": "..."}`;
  return {
    system: 'You write concise, accurate follow-up emails for meetings. Respond with ONLY valid JSON.',
    user,
  };
}

export function parseEmailDraft(text: string, fallbackTitle: string): EmailDraft {
  const parsed = extractJson(text);
  const subject = typeof parsed?.subject === 'string' && parsed.subject.trim() ? parsed.subject.trim() : `Follow-up: ${fallbackTitle}`;
  const body = typeof parsed?.body === 'string' && parsed.body.trim() ? parsed.body.trim() : text.trim();
  return { subject, body };
}

// ----------------------------------------------------------------------------
// Cross-meeting chat
// ----------------------------------------------------------------------------

export interface Chunk {
  recording_id: string;
  title: string;
  text: string;
}

export interface ChatCitation {
  recording_id: string;
  title: string;
  snippet: string;
}

const STOPWORDS = new Set(
  'a an and are as at be but by for from has have how i in is it of on or our that the their this to was we what when where which who why with you your about did do does me my'.split(' ')
);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Split a transcript/summary into ~maxLen char chunks on paragraph/sentence boundaries. */
export function chunkText(text: string, maxLen = 900): string[] {
  const parts = text.split(/\n{2,}|(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length + 1 > maxLen) {
      out.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur} ${p}` : p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function rankChunks(question: string, chunks: Chunk[], limit = 8): Chunk[] {
  const q = tokenize(question);
  if (q.length === 0) return [];
  const scored = chunks
    .map((c) => {
      const words = tokenize(c.text);
      const set = new Set(words);
      let score = 0;
      for (const w of q) if (set.has(w)) score += 1 + Math.min(2, words.filter((x) => x === w).length - 1) * 0.25;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.c);
}

export function buildChatPrompt(question: string, chunks: Chunk[]): { system: string; user: string } {
  const sources = chunks
    .map((c, i) => `[${i + 1}] Meeting "${c.title}":\n${c.text}`)
    .join('\n\n---\n\n');
  return {
    system:
      'You answer questions about a user\'s meetings using ONLY the numbered sources provided. If the sources do not contain the answer, say so. Respond with ONLY valid JSON.',
    user: `Sources:\n${sources}\n\nQuestion: ${question}\n\nRespond with ONLY valid JSON: {"answer": "plain text answer that refers to meetings by title", "sources": [source numbers actually used]}`,
  };
}

/** Citations are built from our own scoped chunks; model-supplied indexes outside the set are dropped. */
export function parseChatAnswer(text: string, chunks: Chunk[]): { answer: string; citations: ChatCitation[] } {
  const parsed = extractJson(text);
  const answer = typeof parsed?.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : text.trim();
  const used: number[] = Array.isArray(parsed?.sources) ? parsed.sources.filter((n: unknown) => Number.isInteger(n)) : [];
  const seen = new Set<string>();
  const citations: ChatCitation[] = [];
  for (const n of used) {
    const c = chunks[n - 1];
    if (!c) continue;
    const key = `${c.recording_id}:${n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({ recording_id: c.recording_id, title: c.title, snippet: c.text.slice(0, 240) });
  }
  return { answer, citations };
}
