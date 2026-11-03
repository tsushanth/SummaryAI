/**
 * User account management routes
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import type { ErrorResponse } from '../types/api.js';
import { runAccountPurge } from '../services/accountPurge.js';
import { createPurgeDeps } from '../services/accountPurgeAdapters.js';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * DELETE /api/users/account
 * Delete the current user's account and everything stored for it: storage objects, Recall.ai meeting media, Twilio
 * recordings, database rows, then the auth user (last). See services/accountPurge.ts for the order and failure policy.
 *
 * Responses (the clients only check that the call did not throw, and sign out afterwards):
 *   200 { success: true, purge: { status: 'complete' } }          everything deleted
 *   202 { success: true, purge: { status: 'pending_external' } }  account deleted; some provider cleanup is queued for retry
 *   202 { success: true, purge: { status: 'in_progress' } }       another request for this user is already running
 *   200 { success: true, purge: { status: 'dry_run', plan } }     ACCOUNT_PURGE_DRY_RUN=true: counted, NOTHING deleted
 *   503 EXTERNAL_DELETE_FAILED                                    provider cleanup failed and no durable retry ledger exists;
 *                                                                 the account is intact, retry the request
 *   500 DELETE_FAILED                                             could not delete the auth user; safe to retry
 * Only the authenticated user's own id is ever used; there is no way to name another user.
 */
router.delete('/account', async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'User not authenticated',
      },
    } satisfies ErrorResponse);
    return;
  }

  console.log('[Users] Delete account request received');

  try {
    const result = await runAccountPurge(userId, createPurgeDeps());
    const purge = { status: result.status, pending: result.pending, ...(result.plan ? { plan: result.plan } : {}) };

    switch (result.status) {
      case 'complete':
      case 'dry_run':
        res.status(200).json({ success: true, purge });
        return;
      case 'pending_external':
      case 'in_progress':
        res.status(202).json({ success: true, purge });
        return;
      case 'blocked':
        res.status(503).json({
          error: {
            code: 'EXTERNAL_DELETE_FAILED',
            message: 'Some of your data could not be removed from our processors yet. Your account was not deleted; please try again in a few minutes.',
          },
        } satisfies ErrorResponse);
        return;
      default:
        res.status(500).json({
          error: { code: 'DELETE_FAILED', message: 'Failed to delete account' },
        } satisfies ErrorResponse);
        return;
    }
  } catch (err) {
    console.error('[Users] Delete account error:', err instanceof Error ? err.message : 'unknown');
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'An error occurred while deleting account',
      },
    } satisfies ErrorResponse);
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
