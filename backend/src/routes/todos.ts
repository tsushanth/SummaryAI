/**
 * Todos API routes
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';

import type { ErrorResponse } from '../types/api.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ============================================================================
// Types
// ============================================================================

interface Todo {
  id: string;
  user_id: string;
  recording_id: string | null;
  title: string;
  description: string | null;
  is_completed: boolean;
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateTodoRequest {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  due_date?: string;
  recording_id?: string;
}

interface UpdateTodoRequest {
  title?: string;
  description?: string;
  is_completed?: boolean;
  priority?: 'low' | 'medium' | 'high';
  due_date?: string | null;
}

interface ListTodosResponse {
  todos: Todo[];
  meta: {
    page: number;
    per_page: number;
    total_count: number;
    total_pages: number;
  };
}

interface CreateTodosFromTextRequest {
  text: string;
  recording_id?: string;
}

// ============================================================================
// Validation Schemas
// ============================================================================

const createTodoSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  due_date: z.string().datetime().optional(),
  recording_id: z.string().uuid().optional(),
});

const updateTodoSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional().nullable(),
  is_completed: z.boolean().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  due_date: z.string().datetime().optional().nullable(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  per_page: z.coerce.number().int().positive().max(100).optional().default(50),
  completed: z.enum(['true', 'false', 'all']).optional().default('all'),
  sort: z.enum(['created_at', 'updated_at', 'due_date', 'priority']).optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

const createFromTextSchema = z.object({
  text: z.string().min(1).max(10000),
  recording_id: z.string().uuid().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/todos
 * List all todos for the authenticated user
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response<ListTodosResponse | ErrorResponse>) => {
    const userId = req.user!.id;
    const query = listQuerySchema.parse(req.query);

    // Build query
    let dbQuery = supabaseAdmin
      .from('todos')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    // Filter by completion status
    if (query.completed === 'true') {
      dbQuery = dbQuery.eq('is_completed', true);
    } else if (query.completed === 'false') {
      dbQuery = dbQuery.eq('is_completed', false);
    }

    // Sorting
    dbQuery = dbQuery.order(query.sort, { ascending: query.order === 'asc' });

    // Pagination
    const offset = (query.page - 1) * query.per_page;
    dbQuery = dbQuery.range(offset, offset + query.per_page - 1);

    const { data: todos, error, count } = await dbQuery;

    if (error) {
      console.error('Failed to list todos:', error);
      throw Errors.internal('Failed to list todos');
    }

    const totalCount = count || 0;
    const totalPages = Math.ceil(totalCount / query.per_page);

    res.json({
      todos: todos || [],
      meta: {
        page: query.page,
        per_page: query.per_page,
        total_count: totalCount,
        total_pages: totalPages,
      },
    });
  })
);

/**
 * POST /api/todos
 * Create a new todo
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response<{ todo: Todo } | ErrorResponse>) => {
    const userId = req.user!.id;
    const body = createTodoSchema.parse(req.body) as CreateTodoRequest;

    const { data: todo, error } = await supabaseAdmin
      .from('todos')
      .insert({
        id: uuidv4(),
        user_id: userId,
        title: body.title,
        description: body.description || null,
        priority: body.priority || 'medium',
        due_date: body.due_date || null,
        recording_id: body.recording_id || null,
        is_completed: false,
      })
      .select()
      .single();

    if (error || !todo) {
      console.error('Failed to create todo:', error);
      throw Errors.internal('Failed to create todo');
    }

    res.status(201).json({ todo });
  })
);

/**
 * POST /api/todos/from-text
 * Parse text (from voice transcription) and create todos
 */
router.post(
  '/from-text',
  asyncHandler(async (req: Request, res: Response<{ todos: Todo[] } | ErrorResponse>) => {
    const userId = req.user!.id;
    const body = createFromTextSchema.parse(req.body) as CreateTodosFromTextRequest;

    // Parse the text to extract todo items
    // Simple parsing: split by newlines, bullet points, or numbered lists
    const lines = body.text
      .split(/[\n\r]+/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Remove common list prefixes
        return line
          .replace(/^[-•*]\s*/, '')
          .replace(/^\d+[.)]\s*/, '')
          .replace(/^(todo|task|item):\s*/i, '')
          .trim();
      })
      .filter(line => line.length > 0 && line.length <= 500);

    if (lines.length === 0) {
      // If no clear list items, treat the whole text as one todo
      const title = body.text.substring(0, 500).trim();
      if (title.length > 0) {
        lines.push(title);
      }
    }

    // Create todos
    const todosToInsert = lines.map(title => ({
      id: uuidv4(),
      user_id: userId,
      title,
      description: null,
      priority: 'medium' as const,
      due_date: null,
      recording_id: body.recording_id || null,
      is_completed: false,
    }));

    if (todosToInsert.length === 0) {
      res.json({ todos: [] });
      return;
    }

    const { data: todos, error } = await supabaseAdmin
      .from('todos')
      .insert(todosToInsert)
      .select();

    if (error || !todos) {
      console.error('Failed to create todos from text:', error);
      throw Errors.internal('Failed to create todos');
    }

    res.status(201).json({ todos });
  })
);

/**
 * GET /api/todos/:id
 * Get a single todo
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response<{ todo: Todo } | ErrorResponse>) => {
    const userId = req.user!.id;
    const todoId = req.params.id;

    const { data: todo, error } = await supabaseAdmin
      .from('todos')
      .select('*')
      .eq('id', todoId)
      .eq('user_id', userId)
      .single();

    if (error || !todo) {
      throw Errors.notFound('Todo not found');
    }

    res.json({ todo });
  })
);

/**
 * PATCH /api/todos/:id
 * Update a todo
 */
router.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response<{ todo: Todo } | ErrorResponse>) => {
    const userId = req.user!.id;
    const todoId = req.params.id;
    const body = updateTodoSchema.parse(req.body) as UpdateTodoRequest;

    // Build update object
    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.due_date !== undefined) updates.due_date = body.due_date;
    if (body.is_completed !== undefined) {
      updates.is_completed = body.is_completed;
      updates.completed_at = body.is_completed ? new Date().toISOString() : null;
    }

    if (Object.keys(updates).length === 0) {
      throw Errors.badRequest('No updates provided');
    }

    const { data: todo, error } = await supabaseAdmin
      .from('todos')
      .update(updates)
      .eq('id', todoId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !todo) {
      throw Errors.notFound('Todo not found');
    }

    res.json({ todo });
  })
);

/**
 * DELETE /api/todos/:id
 * Delete a todo
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response<void | ErrorResponse>) => {
    const userId = req.user!.id;
    const todoId = req.params.id;

    const { error } = await supabaseAdmin
      .from('todos')
      .delete()
      .eq('id', todoId)
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to delete todo:', error);
      throw Errors.internal('Failed to delete todo');
    }

    res.status(204).send();
  })
);

/**
 * POST /api/todos/:id/toggle
 * Toggle todo completion status
 */
router.post(
  '/:id/toggle',
  asyncHandler(async (req: Request, res: Response<{ todo: Todo } | ErrorResponse>) => {
    const userId = req.user!.id;
    const todoId = req.params.id;

    // Get current status
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('todos')
      .select('is_completed')
      .eq('id', todoId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existing) {
      throw Errors.notFound('Todo not found');
    }

    const newStatus = !existing.is_completed;

    const { data: todo, error } = await supabaseAdmin
      .from('todos')
      .update({
        is_completed: newStatus,
        completed_at: newStatus ? new Date().toISOString() : null,
      })
      .eq('id', todoId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !todo) {
      throw Errors.internal('Failed to toggle todo');
    }

    res.json({ todo });
  })
);

export default router;
