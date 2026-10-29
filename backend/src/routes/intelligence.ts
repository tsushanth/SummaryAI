/**
 * Intelligence routes: summary templates, regenerate summary, follow-up email,
 * action items -> todos, and cross-meeting chat. Mounted at /api.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import {
  SUMMARY_TEMPLATES,
  SUMMARY_TEMPLATE_IDS,
  DEFAULT_SUMMARY_TEMPLATE,
  isSummaryTemplateId,
} from '../services/summaryTemplates.js';
import { normalizeActionItems } from '../services/summaryService.js';
import { generateSummary } from '../services/summaryGeneration.js';
import {
  completeText,
  segmentTurns,
  buildFollowUpPrompt,
  parseEmailDraft,
  chunkText,
  rankChunks,
  buildChatPrompt,
  parseChatAnswer,
  type Chunk,
} from '../services/intelligenceService.js';

const router = Router();

const MAX_CHAT_RECORDINGS = 100;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

router.get(
  '/summary-templates',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('preferences')
      .eq('id', req.user!.id)
      .maybeSingle();
    const pref = profile?.preferences?.default_summary_template;
    res.json({
      templates: SUMMARY_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description })),
      default_template: isSummaryTemplateId(pref) ? pref : DEFAULT_SUMMARY_TEMPLATE,
    });
  })
);

router.get(
  '/summary-templates/default',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('preferences')
      .eq('id', req.user!.id)
      .maybeSingle();
    const pref = profile?.preferences?.default_summary_template;
    res.json({ default_template: isSummaryTemplateId(pref) ? pref : DEFAULT_SUMMARY_TEMPLATE });
  })
);

const defaultTemplateSchema = z.object({ template: z.enum(SUMMARY_TEMPLATE_IDS) });

router.put(
  '/summary-templates/default',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { template } = defaultTemplateSchema.parse(req.body);
    const userId = req.user!.id;
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('preferences')
      .eq('id', userId)
      .maybeSingle();
    const preferences = { ...(profile?.preferences ?? {}), default_summary_template: template };
    const { error } = await supabaseAdmin.from('profiles').update({ preferences }).eq('id', userId);
    if (error) throw Errors.internal('Failed to save default template');
    res.json({ default_template: template });
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadOwnedRecording(recordingId: string, userId: string) {
  const { data: recording } = await supabaseAdmin
    .from('recordings')
    .select('id, title, status, recording_type, output_language, summary_template')
    .eq('id', recordingId)
    .eq('user_id', userId)
    .single();
  if (!recording) throw Errors.notFound('Recording');
  return recording;
}

// ---------------------------------------------------------------------------
// Regenerate summary
// ---------------------------------------------------------------------------

const regenerateSchema = z.object({ template: z.enum(SUMMARY_TEMPLATE_IDS) });

router.post(
  '/recordings/:id/regenerate-summary',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const recordingId = req.params.id;
    const { template } = regenerateSchema.parse(req.body);
    const recording = await loadOwnedRecording(recordingId, userId);

    const { data: transcript } = await supabaseAdmin
      .from('transcripts')
      .select('full_text, segments')
      .eq('recording_id', recordingId)
      .maybeSingle();
    if (!transcript) throw Errors.badRequest('Recording has no transcript yet');

    const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
    const speakers = [...new Set(segments.map((s: any) => s.speaker_label).filter(Boolean))] as string[];
    // Same long-transcript handling as the first summary: <= 100k chars is one call, longer is map-reduce (no truncation).
    const turns: string[] = segments.length > 0 ? segmentTurns(segments) : [transcript.full_text ?? ''];

    let parsed;
    try {
      parsed = await generateSummary({
        turns,
        speakers,
        templateId: template,
        languageName: null,
        recordingId,
        model: config.ANTHROPIC_MODEL,
        // completeText carries one 'intelligence' feature label for all calls, and does not expose stop_reason
        // (a truncated reply still fails JSON parsing and is retried once).
        complete: async ({ system, user, maxTokens }) => ({
          text: await completeText({ feature: 'summary', system, user, maxTokens }),
        }),
      });
    } catch (e) {
      console.error('regenerate-summary failed:', e);
      throw Errors.internal('Failed to generate summary');
    }

    const fields = {
      summary: parsed.summary,
      detailed_summary: parsed.detailedSummary,
      key_points: parsed.keyPoints,
      action_items: parsed.actionItems,
      topics: parsed.topics,
    };
    // If migration 021 is not applied yet, retry without the new column instead of failing.
    const dropDetailed = ({ detailed_summary: _omit, ...rest }: typeof fields) => rest;
    let { data: summary, error } = await supabaseAdmin
      .from('summaries')
      .update(fields)
      .eq('recording_id', recordingId)
      .select()
      .maybeSingle();
    if (error && /detailed_summary/.test(error.message)) {
      ({ data: summary, error } = await supabaseAdmin
        .from('summaries')
        .update(dropDetailed(fields))
        .eq('recording_id', recordingId)
        .select()
        .maybeSingle());
    }
    if (error) throw Errors.internal('Failed to store summary');

    let stored = summary;
    if (!stored) {
      let ins = await supabaseAdmin
        .from('summaries')
        .insert({ id: uuidv4(), recording_id: recordingId, ...fields })
        .select()
        .single();
      if (ins.error && /detailed_summary/.test(ins.error.message)) {
        ins = await supabaseAdmin
          .from('summaries')
          .insert({ id: uuidv4(), recording_id: recordingId, ...dropDetailed(fields) })
          .select()
          .single();
      }
      if (ins.error || !ins.data) throw Errors.internal('Failed to store summary');
      stored = ins.data;
    }

    await supabaseAdmin.from('recordings').update({ summary_template: template }).eq('id', recordingId);

    res.json({ summary: { ...stored, action_items: normalizeActionItems(stored.action_items) }, template });
  })
);

// ---------------------------------------------------------------------------
// Follow-up email
// ---------------------------------------------------------------------------

const emailSchema = z.object({
  tone: z.string().max(80).optional(),
  recipient: z.string().max(200).optional(),
});

router.post(
  '/recordings/:id/follow-up-email',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const recordingId = req.params.id;
    const body = emailSchema.parse(req.body ?? {});
    const recording = await loadOwnedRecording(recordingId, userId);

    const { data: summary } = await supabaseAdmin
      .from('summaries')
      .select('summary, key_points, action_items')
      .eq('recording_id', recordingId)
      .maybeSingle();
    if (!summary) throw Errors.badRequest('Recording has no summary yet');

    const items = normalizeActionItems(summary.action_items);
    const { system, user } = buildFollowUpPrompt({
      title: recording.title,
      summary: summary.summary,
      keyPoints: Array.isArray(summary.key_points) ? summary.key_points : [],
      actionItems: items,
      tone: body.tone,
      recipient: body.recipient,
    });

    let text: string;
    try {
      text = await completeText({ feature: 'follow_up_email', system, user, maxTokens: 1024 });
    } catch (e) {
      console.error('follow-up-email failed:', e);
      throw Errors.internal('Failed to draft email');
    }
    res.json(parseEmailDraft(text, recording.title));
  })
);

// ---------------------------------------------------------------------------
// Action items -> todos
// ---------------------------------------------------------------------------

/** Accept YYYY-MM-DD or a full ISO date; anything else (e.g. "next week") becomes null. */
export function toIsoDueDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

router.post(
  '/recordings/:id/action-items-to-todos',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const recordingId = req.params.id;
    await loadOwnedRecording(recordingId, userId);

    const { data: summary } = await supabaseAdmin
      .from('summaries')
      .select('action_items')
      .eq('recording_id', recordingId)
      .maybeSingle();
    const items = normalizeActionItems(summary?.action_items);
    if (items.length === 0) {
      res.json({ todos: [], skipped: 0 });
      return;
    }

    const { data: existing } = await supabaseAdmin
      .from('todos')
      .select('title')
      .eq('user_id', userId)
      .eq('recording_id', recordingId);
    const have = new Set((existing ?? []).map((t: { title: string }) => t.title.trim().toLowerCase()));

    const fresh = items.filter((i) => !have.has(i.task.toLowerCase()));
    const rows = fresh.map((i) => ({
      id: uuidv4(),
      user_id: userId,
      recording_id: recordingId,
      title: i.task.slice(0, 500),
      priority: i.priority,
      assignee: i.assignee,
      due_date: toIsoDueDate(i.due_date),
      is_completed: false,
    }));

    if (rows.length === 0) {
      res.json({ todos: [], skipped: items.length });
      return;
    }
    const { data: todos, error } = await supabaseAdmin.from('todos').insert(rows).select();
    if (error || !todos) throw Errors.internal('Failed to create todos');
    res.status(201).json({
      todos: todos.map((t: any) => ({ ...t, notes: t.description ?? null })),
      skipped: items.length - rows.length,
    });
  })
);

// ---------------------------------------------------------------------------
// Cross-meeting chat
// ---------------------------------------------------------------------------

const chatSchema = z.object({
  question: z.string().min(3).max(1000),
  recording_ids: z.array(z.string().uuid()).max(MAX_CHAT_RECORDINGS).optional(),
});

router.post(
  '/chat',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const body = chatSchema.parse(req.body);

    // 1. Scope first: only recordings owned by this user are ever read below.
    const { data: owned } = await supabaseAdmin
      .from('recordings')
      .select('id, title')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_CHAT_RECORDINGS);
    let recordings: { id: string; title: string }[] = owned ?? [];
    if (body.recording_ids?.length) {
      const wanted = new Set(body.recording_ids);
      recordings = recordings.filter((r) => wanted.has(r.id));
    }
    if (recordings.length === 0) {
      res.json({ answer: 'You have no recordings to search yet.', citations: [] });
      return;
    }
    const ids = recordings.map((r) => r.id);
    const titles = new Map(recordings.map((r) => [r.id, r.title]));

    // 2. Retrieve, constrained to those ids (and re-checked against the owned set).
    const [{ data: summaries }, { data: transcripts }] = await Promise.all([
      supabaseAdmin.from('summaries').select('recording_id, summary, key_points').in('recording_id', ids),
      supabaseAdmin.from('transcripts').select('recording_id, full_text').in('recording_id', ids),
    ]);

    const chunks: Chunk[] = [];
    for (const s of summaries ?? []) {
      const title = titles.get(s.recording_id);
      if (title === undefined) continue;
      const kp = Array.isArray(s.key_points) ? s.key_points.join('. ') : '';
      for (const text of chunkText(`${s.summary} ${kp}`)) chunks.push({ recording_id: s.recording_id, title, text });
    }
    for (const t of transcripts ?? []) {
      const title = titles.get(t.recording_id);
      if (title === undefined) continue;
      for (const text of chunkText(t.full_text ?? '')) chunks.push({ recording_id: t.recording_id, title, text });
    }

    const top = rankChunks(body.question, chunks);
    if (top.length === 0) {
      res.json({ answer: "I couldn't find anything about that in your meetings.", citations: [] });
      return;
    }

    const { system, user } = buildChatPrompt(body.question, top);
    let text: string;
    try {
      text = await completeText({ feature: 'cross_meeting_chat', system, user, maxTokens: 1024 });
    } catch (e) {
      console.error('chat failed:', e);
      throw Errors.internal('Failed to answer question');
    }
    res.json(parseChatAnswer(text, top));
  })
);

export default router;
