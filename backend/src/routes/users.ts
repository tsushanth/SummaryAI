/**
 * User account management routes
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import type { ErrorResponse } from '../types/api.js';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * DELETE /api/users/account
 * Delete the current user's account and all associated data
 */
router.delete('/account', async (req: Request, res: Response<{ success: boolean } | ErrorResponse>) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'User not authenticated',
      },
    });
    return;
  }

  console.log(`[Users] Delete account request for user: ${userId}`);

  try {
    // Delete user data from all tables first (in order of dependencies)

    // 1. Delete todos
    const { error: todosError } = await supabaseAdmin
      .from('todos')
      .delete()
      .eq('user_id', userId);

    if (todosError) {
      console.warn(`[Users] Error deleting todos: ${todosError.message}`);
    }

    // 2. Delete recordings (this may cascade to related data)
    const { error: recordingsError } = await supabaseAdmin
      .from('recordings')
      .delete()
      .eq('user_id', userId);

    if (recordingsError) {
      console.warn(`[Users] Error deleting recordings: ${recordingsError.message}`);
    }

    // 3. Delete calendar connections
    const { error: calendarError } = await supabaseAdmin
      .from('calendar_connections')
      .delete()
      .eq('user_id', userId);

    if (calendarError) {
      console.warn(`[Users] Error deleting calendar connections: ${calendarError.message}`);
    }

    // 4. Delete scheduled bots
    const { error: botsError } = await supabaseAdmin
      .from('scheduled_bots')
      .delete()
      .eq('user_id', userId);

    if (botsError) {
      console.warn(`[Users] Error deleting scheduled bots: ${botsError.message}`);
    }

    // 5. Delete profile
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (profileError) {
      console.warn(`[Users] Error deleting profile: ${profileError.message}`);
    }

    // 6. Finally, delete the auth user using admin API
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authError) {
      console.error(`[Users] Error deleting auth user: ${authError.message}`);
      res.status(500).json({
        error: {
          code: 'DELETE_FAILED',
          message: `Failed to delete account: ${authError.message}`,
        },
      });
      return;
    }

    console.log(`[Users] Successfully deleted account for user: ${userId}`);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Users] Delete account error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'An error occurred while deleting account',
      },
    });
  }
});

/**
 * GET /api/users/me
 * Get current user profile
 */
router.get('/me', async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'User not authenticated',
      },
    });
    return;
  }

  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error(`[Users] Error fetching profile: ${error.message}`);
      res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to fetch profile',
        },
      });
      return;
    }

    res.status(200).json({
      user: {
        id: userId,
        email: req.user?.email,
        profile: profile || null,
      },
    });
  } catch (err) {
    console.error('[Users] Get profile error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'An error occurred while fetching profile',
      },
    });
  }
});

export default router;
