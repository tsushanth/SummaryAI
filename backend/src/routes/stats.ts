/**
 * Weekly stats for the home card: meetings, hours recorded, action items (last 7 days).
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();
router.use(authenticate);

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function summarizeWeek(rows: Array<{ duration_seconds?: number | null }>) {
  const seconds = rows.reduce((sum, r) => sum + Math.max(0, Number(r.duration_seconds) || 0), 0);
  return { meetings: rows.length, seconds_recorded: seconds, hours_recorded: Math.round((seconds / 3600) * 10) / 10 };
}

router.get(
  '/weekly',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const since = new Date(Date.now() - WEEK_MS).toISOString();

    const [recs, todos] = await Promise.all([
      supabaseAdmin
        .from('recordings')
        .select('duration_seconds')
        .eq('user_id', userId)
        .neq('status', 'failed')
        .gte('created_at', since)
        .limit(1000),
      supabaseAdmin
        .from('todos')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', since),
    ]);
    if (recs.error) throw new Error(recs.error.message);
    if (todos.error) throw new Error(todos.error.message);

    res.json({ since, ...summarizeWeek(recs.data ?? []), action_items: todos.count ?? 0 });
  })
);

export default router;
