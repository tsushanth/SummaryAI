/**
 * Health check routes
 */

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';

const router = Router();

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  checks: {
    database: 'ok' | 'error';
    storage: 'ok' | 'error';
  };
}

/**
 * GET /health
 * Basic health check for load balancers
 */
router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * GET /health/detailed
 * Detailed health check with dependency status
 */
router.get('/detailed', async (_req: Request, res: Response<HealthResponse>) => {
  const checks: { database: 'ok' | 'error'; storage: 'ok' | 'error' } = {
    database: 'ok',
    storage: 'ok',
  };

  // Check database connection
  try {
    const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
    if (error) {
      checks.database = 'error';
    }
  } catch {
    checks.database = 'error';
  }

  // Check storage connection
  try {
    const { error } = await supabaseAdmin.storage.from(config.STORAGE_BUCKET_AUDIO).list('', { limit: 1 });
    if (error) {
      checks.storage = 'error';
    }
  } catch {
    checks.storage = 'error';
  }

  // Determine overall status
  const hasErrors = checks.database === 'error' || checks.storage === 'error';
  const status = hasErrors ? 'degraded' : 'healthy';

  res.status(hasErrors ? 503 : 200).json({
    status,
    version: config.API_VERSION,
    timestamp: new Date().toISOString(),
    checks,
  });
});

export default router;
