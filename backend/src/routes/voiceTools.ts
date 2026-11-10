/**
 * Assistant tools over the caller's own meetings. Mounted at /api/voice-tools.
 *
 * Read tools (list, brief, search, snippet, actions, date, debrief) never change data. The one write path is a two-step
 * action create: POST /actions/draft returns the parsed fields and a signed draft (nothing saved), POST /actions saves
 * exactly those fields. Nothing here posts to another service or sends anything.
 *
 * Every query is scoped to req.user.id first (owned recordings, then only those ids are read), the same way /api/chat is.
 * The whole router answers 404 unless VOICE_TOOLS_ENABLED=true, VOICE_TOOLS_SECRET is set and the user is allow-listed.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { normalizeActionItems } from '../services/summaryService.js';
import {
  completeDebriefText,
  extractJson,
  segmentTurns,
  chunkText,
  rankChunks,
  type Chunk,
} from '../services/intelligenceService.js';
import {
  voiceToolsAllowed,
  validTimeZone,
  localDate,
  resolveDueText,
  summaryItemKey,
  normalizeTitle,
  signDraft,
  verifyDraft,
  todoIdForDraft,
  actionReadback,
  buildDebriefPrompt,
  parseDebrief,
  type ActionDraftFields,
} from '../services/voiceTools.js';

const router = Router();

const MAX_SCOPE_RECORDINGS = 100;
const MAX_DEBRIEF_TRANSCRIPT_CHARS = 100_000;

router.use(authenticate);
router.use((req: Request, _res: Response, next: NextFunction) => {
  if (!voiceToolsAllowed(config as any, req.user?.id)) return next(Errors.notFound('Resource'));
  next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OwnedRecording {
  id: string;
  title: string;
  created_at: string;
  duration_seconds: number | null;
  status?: string;
}

async function ownedRecordings(userId: string, limit = MAX_SCOPE_RECORDINGS): Promise<OwnedRecording[]> {
  const { data, error } = await supabaseAdmin
    .from('recordings')
    .select('id, title, created_at, duration_seconds, status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw Errors.internal('Failed to load meetings');
  return (data ?? []) as OwnedRecording[];
}

async function loadOwned(recordingId: string, userId: string): Promise<OwnedRecording> {
  const { data } = await supabaseAdmin
    .from('recordings')
    .select('id, title, created_at, duration_seconds, status')
    .eq('id', recordingId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw Errors.notFound('Recording');
  return data as OwnedRecording;
}

const idParam = z.string().uuid();

function dayOf(iso: string): string {
  return (iso ?? '').slice(0, 10);
}

// ---------------------------------------------------------------------------
// get_date
// ---------------------------------------------------------------------------

router.get(
  '/date',
  asyncHandler(async (req: Request, res: Response) => {
    const tz = validTimeZone(typeof req.query.tz === 'string' ? req.query.tz : undefined);
    const now = new Date();
    const { ymd, weekday } = localDate(now, tz);
    res.json({
      now: now.toISOString(),
      timezone: tz,
      today: ymd,
      weekday: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][weekday],
    });
  })
);

// ---------------------------------------------------------------------------
// list_meetings
// ---------------------------------------------------------------------------

const listSchema = z.object({
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  limit: z.coerce.number().int().positive().max(10).optional().default(5),
});

router.get(
  '/meetings',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const q = listSchema.parse(req.query);
    let recs = await ownedRecordings(userId);
    if (q.since) recs = recs.filter((r) => dayOf(r.created_at) >= q.since!.slice(0, 10));
    if (q.until) recs = recs.filter((r) => dayOf(r.created_at) <= q.until!.slice(0, 10));
    recs = recs.slice(0, q.limit);
    const ids = recs.map((r) => r.id);
    const { data: sums } = ids.length
      ? await supabaseAdmin.from('summaries').select('recording_id, summary').in('recording_id', ids)
      : { data: [] as any[] };
    const first = new Map<string, string>();
    for (const s of sums ?? []) first.set(s.recording_id, String(s.summary ?? '').split(/(?<=[.!?])\s/)[0]?.slice(0, 200) ?? '');
    res.json({
      meetings: recs.map((r) => ({
        id: r.id,
        title: r.title,
        date: dayOf(r.created_at),
        duration_seconds: r.duration_seconds ?? null,
        one_line: first.get(r.id) || null,
      })),
    });
  })
);

// ---------------------------------------------------------------------------
// get_meeting_brief
// ---------------------------------------------------------------------------

router.get(
  '/meetings/:id/brief',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = idParam.parse(req.params.id);
    const rec = await loadOwned(id, userId);
    const { data: summary } = await supabaseAdmin.from('summaries').select('*').eq('recording_id', id).maybeSingle();
    if (!summary) {
      res.json({ id, title: rec.title, date: dayOf(rec.created_at), has_summary: false });
      return;
    }
    const { data: todos } = await supabaseAdmin.from('todos').select('*').eq('user_id', userId).eq('recording_id', id);
    const items = normalizeActionItems(summary.action_items).map((i) => {
      const key = summaryItemKey(id, i.task);
      const t = (todos ?? []).find((x: any) => x.summary_item_key === key || normalizeTitle(x.title) === normalizeTitle(i.task));
      return {
        key,
        task: i.task,
        assignee: i.assignee,
        due_date: i.due_date,
        priority: i.priority,
        status: t ? (t.is_completed ? 'done' : 'open') : 'not_tracked',
        todo_id: t?.id ?? null,
      };
    });
    res.json({
      id,
      title: rec.title,
      date: dayOf(rec.created_at),
      has_summary: true,
      summary: summary.summary,
      key_points: Array.isArray(summary.key_points) ? summary.key_points : [],
      // Null until the decisions column exists and has been filled; use POST /meetings/:id/debrief to extract them.
      decisions: Array.isArray(summary.decisions) ? summary.decisions : null,
      action_items: items,
    });
  })
);

// ---------------------------------------------------------------------------
// search_meetings
// ---------------------------------------------------------------------------

const searchSchema = z.object({
  query: z.string().trim().min(3).max(300),
  limit: z.coerce.number().int().positive().max(5).optional().default(5),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
});

router.post(
  '/search',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const body = searchSchema.parse(req.body);
    let recs = await ownedRecordings(userId);
    if (body.since) recs = recs.filter((r) => dayOf(r.created_at) >= body.since!.slice(0, 10));
    if (body.until) recs = recs.filter((r) => dayOf(r.created_at) <= body.until!.slice(0, 10));
    if (recs.length === 0) {
      res.json({ results: [] });
      return;
    }
    const ids = recs.map((r) => r.id);
    const meta = new Map(recs.map((r) => [r.id, r]));
    const [{ data: sums }, { data: trs }] = await Promise.all([
      supabaseAdmin.from('summaries').select('recording_id, summary, key_points').in('recording_id', ids),
      supabaseAdmin.from('transcripts').select('recording_id, full_text').in('recording_id', ids),
    ]);
    const chunks: Chunk[] = [];
    for (const s of sums ?? []) {
      const m = meta.get(s.recording_id);
      if (!m) continue;
      const kp = Array.isArray(s.key_points) ? s.key_points.join('. ') : '';
      for (const text of chunkText(`${s.summary ?? ''} ${kp}`)) chunks.push({ recording_id: s.recording_id, title: m.title, text });
    }
    for (const t of trs ?? []) {
      const m = meta.get(t.recording_id);
      if (!m) continue;
      for (const text of chunkText(t.full_text ?? '')) chunks.push({ recording_id: t.recording_id, title: m.title, text });
    }
    const top = rankChunks(body.query, chunks, body.limit);
    res.json({
      results: top.map((c) => ({
        recording_id: c.recording_id,
        title: c.title,
        date: dayOf(meta.get(c.recording_id)!.created_at),
        snippet: c.text.slice(0, 400),
      })),
    });
  })
);

// ---------------------------------------------------------------------------
// get_transcript_snippet
// ---------------------------------------------------------------------------

const snippetSchema = z.object({
  query: z.string().trim().min(2).max(200).optional(),
  from: z.coerce.number().nonnegative().optional(),
  to: z.coerce.number().nonnegative().optional(),
  max_chars: z.coerce.number().int().positive().max(2000).optional().default(800),
});

router.get(
  '/meetings/:id/snippet',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = idParam.parse(req.params.id);
    const q = snippetSchema.parse(req.query);
    if (q.query === undefined && q.from === undefined) throw Errors.badRequest('Give a query or a start time');
    const rec = await loadOwned(id, userId);
    const { data: tr } = await supabaseAdmin.from('transcripts').select('segments, full_text').eq('recording_id', id).maybeSingle();
    const segs: any[] = Array.isArray(tr?.segments) ? tr.segments : [];
    let picked = segs;
    if (q.from !== undefined) {
      picked = segs.filter((s) => (s.start_time ?? 0) >= q.from! && (s.start_time ?? 0) <= (q.to ?? q.from! + 120));
    } else if (q.query) {
      const needle = q.query.toLowerCase();
      const i = segs.findIndex((s) => String(s.text ?? '').toLowerCase().includes(needle));
      picked = i < 0 ? [] : segs.slice(Math.max(0, i - 1), i + 2);
    }
    const lines = segmentTurns(picked).join('\n');
    res.json({ recording_id: id, title: rec.title, date: dayOf(rec.created_at), text: lines.slice(0, q.max_chars), found: picked.length > 0 });
  })
);

// ---------------------------------------------------------------------------
// list_actions
// ---------------------------------------------------------------------------

const actionsSchema = z.object({
  status: z.enum(['open', 'done', 'all']).optional().default('open'),
  assignee: z.string().trim().max(100).optional(),
  due_before: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  recording_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(25).optional().default(10),
});

interface ActionRow {
  id: string;
  kind: 'todo' | 'summary_item';
  title: string;
  assignee: string | null;
  due_date: string | null;
  priority: string;
  is_completed: boolean;
  recording_id: string | null;
  meeting_title: string | null;
  meeting_date: string | null;
  key: string | null;
}

router.get(
  '/actions',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const q = actionsSchema.parse(req.query);
    const recs = await ownedRecordings(userId);
    const meta = new Map(recs.map((r) => [r.id, r]));

    const { data: todoRows, error } = await supabaseAdmin.from('todos').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
    if (error) throw Errors.internal('Failed to load actions');

    const rows: ActionRow[] = [];
    const tracked = new Set<string>();
    for (const t of todoRows ?? []) {
      const m = t.recording_id ? meta.get(t.recording_id) : undefined;
      if (t.recording_id) {
        tracked.add(`${t.recording_id}|${normalizeTitle(t.title)}`);
        if (t.summary_item_key) tracked.add(`${t.recording_id}|key|${t.summary_item_key}`);
      }
      rows.push({
        id: t.id,
        kind: 'todo',
        title: t.title,
        assignee: t.assignee ?? null,
        due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
        priority: t.priority ?? 'medium',
        is_completed: !!t.is_completed,
        recording_id: t.recording_id ?? null,
        meeting_title: m?.title ?? null,
        meeting_date: m ? dayOf(m.created_at) : null,
        key: t.summary_item_key ?? null,
      });
    }

    // Summary action items nobody has turned into a todo yet (they count as open, and carry a stable key).
    const ids = recs.map((r) => r.id);
    const { data: sums } = ids.length ? await supabaseAdmin.from('summaries').select('recording_id, action_items').in('recording_id', ids) : { data: [] as any[] };
    for (const s of sums ?? []) {
      const m = meta.get(s.recording_id);
      if (!m) continue;
      for (const it of normalizeActionItems(s.action_items)) {
        const key = summaryItemKey(s.recording_id, it.task);
        if (tracked.has(`${s.recording_id}|${normalizeTitle(it.task)}`) || tracked.has(`${s.recording_id}|key|${key}`)) continue;
        rows.push({
          id: `item:${s.recording_id}:${key}`,
          kind: 'summary_item',
          title: it.task,
          assignee: it.assignee,
          due_date: it.due_date && /^\d{4}-\d{2}-\d{2}/.test(it.due_date) ? it.due_date.slice(0, 10) : null,
          priority: it.priority,
          is_completed: false,
          recording_id: s.recording_id,
          meeting_title: m.title,
          meeting_date: dayOf(m.created_at),
          key,
        });
      }
    }

    let out = rows;
    if (q.recording_id) out = out.filter((r) => r.recording_id === q.recording_id);
    if (q.status === 'open') out = out.filter((r) => !r.is_completed);
    if (q.status === 'done') out = out.filter((r) => r.is_completed);
    if (q.assignee) {
      const a = q.assignee.toLowerCase();
      out = a === 'me' ? out.filter((r) => !r.assignee) : out.filter((r) => (r.assignee ?? '').toLowerCase().includes(a));
    }
    if (q.due_before) out = out.filter((r) => r.due_date !== null && r.due_date <= q.due_before!.slice(0, 10));
    // Dated items first (soonest first), then undated, newest meeting first within each group.
    out = [...out].sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return (b.meeting_date ?? '') < (a.meeting_date ?? '') ? -1 : 1;
    });
    res.json({ total: out.length, actions: out.slice(0, q.limit) });
  })
);

// ---------------------------------------------------------------------------
// create_action (draft) and commit
// ---------------------------------------------------------------------------

const draftSchema = z.object({
  title: z.string().trim().min(2).max(500),
  assignee: z.string().trim().max(100).nullish(),
  due: z.string().trim().max(60).nullish(), // as said ("friday") or an ISO date
  tz: z.string().max(64).optional(),
  priority: z.enum(['none', 'low', 'medium', 'high']).optional().default('none'),
  recording_id: z.string().uuid().nullish(),
  summary_item_key: z.string().regex(/^[0-9a-f]{16}$/).nullish(),
});

router.post(
  '/actions/draft',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const body = draftSchema.parse(req.body);
    if (body.recording_id) await loadOwned(body.recording_id, userId);
    let due: string | null = null;
    if (body.due) {
      due = resolveDueText(body.due, new Date(), body.tz);
      // Do not guess: tell the client so it can ask the user for a date.
      if (!due) throw new AppError(422, 'DUE_NOT_UNDERSTOOD', 'Could not read the due date; ask the user for a date');
    }
    const fields: ActionDraftFields = {
      title: body.title,
      assignee: body.assignee || null,
      due_date: due,
      priority: body.priority,
      recording_id: body.recording_id ?? null,
      summary_item_key: body.summary_item_key ?? null,
    };
    res.json({ draft_id: signDraft(config.VOICE_TOOLS_SECRET!, userId, fields), fields, readback: actionReadback(fields), saved: false });
  })
);

const commitSchema = z.object({ draft_id: z.string().min(20).max(4000) });

router.post(
  '/actions',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { draft_id } = commitSchema.parse(req.body);
    const check = verifyDraft(config.VOICE_TOOLS_SECRET!, userId, draft_id);
    if ('reason' in check) throw new AppError(check.reason === 'expired' ? 410 : 400, 'DRAFT_' + check.reason.toUpperCase(), 'Draft is not valid');
    const f = check.fields;
    // The recording may have been deleted since the draft was made.
    if (f.recording_id) await loadOwned(f.recording_id, userId);

    const id = todoIdForDraft(draft_id);
    const { data: existing } = await supabaseAdmin.from('todos').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (existing) {
      res.json({ todo: { ...existing, notes: existing.description ?? null }, created: false });
      return;
    }
    const base = {
      id,
      user_id: userId,
      recording_id: f.recording_id,
      title: f.title,
      priority: f.priority,
      assignee: f.assignee,
      due_date: f.due_date ? new Date(`${f.due_date}T00:00:00Z`).toISOString() : null,
      is_completed: false,
    };
    // source / summary_item_key come from migration 028; until it is applied, save without them.
    let ins: { data: any; error: any } = await supabaseAdmin.from('todos').insert({ ...base, source: 'voice', summary_item_key: f.summary_item_key }).select().single();
    if (ins.error && /source|summary_item_key/.test(String(ins.error.message))) {
      ins = await supabaseAdmin.from('todos').insert(base).select().single();
    }
    if (ins.error || !ins.data) throw Errors.internal('Failed to save action');
    res.status(201).json({ todo: { ...ins.data, notes: ins.data.description ?? null }, created: true });
  })
);

// ---------------------------------------------------------------------------
// debrief: decisions + actions, each backed by a transcript quote
// ---------------------------------------------------------------------------

router.post(
  '/meetings/:id/debrief',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = idParam.parse(req.params.id);
    const rec = await loadOwned(id, userId);
    const { data: tr } = await supabaseAdmin.from('transcripts').select('segments, full_text').eq('recording_id', id).maybeSingle();
    if (!tr) throw Errors.badRequest('Recording has no transcript yet');
    const segments: any[] = Array.isArray(tr.segments) ? tr.segments : [];
    const fullText: string = tr.full_text ?? '';
    let turns = segments.length > 0 ? segmentTurns(segments) : [fullText];
    // One call only. A longer transcript is cut and the reply says so; no silent partial results.
    let joined = turns.join('\n');
    let truncated = false;
    if (joined.length > MAX_DEBRIEF_TRANSCRIPT_CHARS) {
      joined = joined.slice(0, MAX_DEBRIEF_TRANSCRIPT_CHARS);
      turns = [joined];
      truncated = true;
    }
    if (joined.trim().split(/\s+/).length < 25) {
      res.json({ id, title: rec.title, date: dayOf(rec.created_at), decisions: [], actions: [], dropped: 0, truncated: false, note: 'Too little was said to debrief.' });
      return;
    }
    const { system, user } = buildDebriefPrompt({ title: rec.title, turns });
    let text: string;
    try {
      text = await completeDebriefText({ system, user });
    } catch (e) {
      console.error('debrief failed:', e);
      throw Errors.internal('Failed to build debrief');
    }
    const tz = typeof req.query.tz === 'string' ? req.query.tz : 'UTC';
    // "Friday" in a transcript is relative to the meeting day, not to today.
    const meetingDay = new Date(rec.created_at);
    const debrief = parseDebrief(extractJson(text), segments, fullText, (said) => resolveDueText(said, meetingDay, tz));
    res.json({
      id,
      title: rec.title,
      date: dayOf(rec.created_at),
      decisions: debrief.decisions,
      actions: debrief.actions.map((a) => ({ ...a, key: summaryItemKey(id, a.text) })),
      dropped: debrief.dropped,
      truncated,
    });
  })
);

export default router;
