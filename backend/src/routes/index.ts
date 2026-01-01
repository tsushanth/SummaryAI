/**
 * Route aggregator
 */

import { Router } from 'express';
import healthRoutes from './health.js';
import recordingsRoutes from './recordings.js';

const router = Router();

// Health checks (no auth required)
router.use('/health', healthRoutes);

// API routes
router.use('/api/recordings', recordingsRoutes);

export default router;
