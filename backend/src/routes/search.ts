/**
 * Cross-recording search (slice C): GET /api/search?q=...
 * Matches title, summary text and transcript text of the caller's recordings only.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

const querySchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().positive().max(50).optional().default(30),
});

/** Escape LIKE wildcards so user input is matched literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function makeSnippet(text: string, q: string, radius = 60): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + q.length + radius);
  return `${start > 0 ? '...' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '...' : ''}`;
}

type Hit = { recording_id: string; match: 'title' | 'summary' | 'transcript'; snippet: string };

router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { q, limit } = querySchema.parse(req.query);
    const pattern = `%${escapeLike(q)}%`;

    const [titles, summaries, transcripts] = await Promise.all([
      supabaseAdmin
        .from('recordings')
        .select('id, title')
        .eq('user_id', userId)
        .ilike('title', pattern)
        .limit(limit),
      supabaseAdmin
        .from('summaries')
        .select('recording_id, summary, recordings!inner(user_id)')
        .eq('recordings.user_id', userId)
        .ilike('summary', pattern)
        .limit(limit),
      supabaseAdmin
        .from('transcripts')
        .select('recording_id, full_text, recordings!inner(user_id)')
        .eq('recordings.user_id', userId)
        .ilike('full_text', pattern)
        .limit(limit),
    ]);

    if (titles.error || summaries.error || transcripts.error) {
      console.error('Search failed:', titles.error || summaries.error || transcripts.error);
      throw Errors.internal('Search failed');
    }

    // One hit per recording, best match first: title > summary > transcript.
    const hits = new Map<string, Hit>();
    for (const r of titles.data || []) {
      hits.set(r.id, { recording_id: r.id, match: 'title', snippet: r.title });
    }
    for (const s of summaries.data || []) {
      if (!hits.has(s.recording_id)) {
        hits.set(s.recording_id, { recording_id: s.recording_id, match: 'summary', snippet: makeSnippet(s.summary, q) });
      }
    }
    for (const t of transcripts.data || []) {
      if (!hits.has(t.recording_id)) {
        hits.set(t.recording_id, { recording_id: t.recording_id, match: 'transcript', snippet: makeSnippet(t.full_text, q) });
      }
    }

    const ids = [...hits.keys()].slice(0, limit);
    if (ids.length === 0) {
      res.json({ results: [] });
      return;
    }

    const { data: recordings, error } = await supabaseAdmin
      .from('recordings')
      .select('id, title, created_at, duration_seconds, status, is_favorite, tags, folder_id')
      .eq('user_id', userId)
      .in('id', ids)
      .order('created_at', { ascending: false });
    if (error) throw Errors.internal('Search failed');

    res.json({
      results: (recordings || []).map((rec) => ({
        recording: rec,
        match: hits.get(rec.id)!.match,
        snippet: hits.get(rec.id)!.snippet,
      })),
    });
  })
);

export default router;
