/**
 * Folders and tags API (slice C: organization).
 *
 * Mounted at /api/folders and /api/tags (see routes/index.ts). All routes
 * require auth and every query is scoped to the authenticated user id.
 * Assigning a recording to a folder is done via PATCH /api/recordings/:id
 * with { folder_id }.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const foldersRouter = Router();
export const tagsRouter = Router();

const folderNameSchema = z.string().trim().min(1).max(60);
const idSchema = z.string().uuid();

function parseId(raw: string): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw Errors.notFound('Folder');
  return parsed.data;
}

// GET /api/folders -> { folders: [{ id, name, recording_count, created_at, updated_at }] }
foldersRouter.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const { data: folders, error } = await supabaseAdmin
      .from('folders')
      .select('id, name, created_at, updated_at')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error) throw Errors.internal('Failed to fetch folders');

    const { data: filed, error: countError } = await supabaseAdmin
      .from('recordings')
      .select('folder_id')
      .eq('user_id', userId)
      .not('folder_id', 'is', null);
    if (countError) throw Errors.internal('Failed to fetch folders');

    const counts = new Map<string, number>();
    for (const r of filed || []) counts.set(r.folder_id, (counts.get(r.folder_id) || 0) + 1);

    res.json({
      folders: (folders || []).map((f) => ({ ...f, recording_count: counts.get(f.id) || 0 })),
    });
  })
);

// POST /api/folders { name }
foldersRouter.post(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const body = z.object({ name: folderNameSchema }).parse(req.body);

    const { data: folder, error } = await supabaseAdmin
      .from('folders')
      .insert({ user_id: userId, name: body.name })
      .select('id, name, created_at, updated_at')
      .single();

    if (error?.code === '23505') throw Errors.conflict('A folder with that name already exists');
    if (error || !folder) throw Errors.internal('Failed to create folder');

    res.status(201).json({ folder: { ...folder, recording_count: 0 } });
  })
);

// PATCH /api/folders/:id { name }
foldersRouter.patch(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);
    const body = z.object({ name: folderNameSchema }).parse(req.body);

    const { data: folder, error } = await supabaseAdmin
      .from('folders')
      .update({ name: body.name, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, name, created_at, updated_at')
      .maybeSingle();

    if (error?.code === '23505') throw Errors.conflict('A folder with that name already exists');
    if (error) throw Errors.internal('Failed to rename folder');
    if (!folder) throw Errors.notFound('Folder');

    res.json({ folder });
  })
);

// DELETE /api/folders/:id  (recordings in it become unfiled; never deleted)
foldersRouter.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = parseId(req.params.id);

    const { data: deleted, error } = await supabaseAdmin
      .from('folders')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .select('id');

    if (error) throw Errors.internal('Failed to delete folder');
    if (!deleted || deleted.length === 0) throw Errors.notFound('Folder');

    res.status(204).send();
  })
);

// GET /api/tags -> { tags: [{ tag, count }] } sorted by count desc
tagsRouter.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const { data, error } = await supabaseAdmin
      .from('recordings')
      .select('tags')
      .eq('user_id', userId);
    if (error) throw Errors.internal('Failed to fetch tags');

    const counts = new Map<string, { tag: string; count: number }>();
    for (const row of data || []) {
      for (const tag of row.tags || []) {
        const key = String(tag).toLowerCase();
        const existing = counts.get(key);
        if (existing) existing.count += 1;
        else counts.set(key, { tag: String(tag), count: 1 });
      }
    }

    res.json({
      tags: [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    });
  })
);
