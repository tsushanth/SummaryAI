/**
 * Health check routes
 */

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { getLoopStatus } from '../lib/loopMonitor.js';

const router = Router();

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  checks: {
    database: 'ok' | 'error';
    storage: 'ok' | 'error';
  };
  loops?: { name: string; minutesSinceHeartbeat: number | null; stale: boolean }[];
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

  // Background loops: stale = no heartbeat for 3x its interval (min 10 min). Point the reporter's backend probe at this URL
  // to get a dead-man signal for a loop that stopped while the process stays up.
  const loops = getLoopStatus();
  const hasErrors = checks.database === 'error' || checks.storage === 'error' || loops.some((l) => l.stale);
  const status = hasErrors ? 'degraded' : 'healthy';

  res.status(hasErrors ? 503 : 200).json({
    status,
    version: config.API_VERSION,
    timestamp: new Date().toISOString(),
    checks,
    loops,
  } as HealthResponse);
});

export default router;
