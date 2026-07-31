/**
 * Route aggregator
 */

import { Router } from 'express';
import healthRoutes from './health.js';
import recordingsRoutes from './recordings.js';
import todosRoutes from './todos.js';
import usersRoutes from './users.js';
import meetingsRoutes, { meetingsWorkerRouter } from './meetings.js';
import calendarRoutes, { calendarCallbackRouter } from './calendar.js';
import webhooksRoutes from './webhooks.js';
import phoneRoutes from './phone.js';
import subscriptionsRoutes from './subscriptions.js';
import attributionRoutes from './attribution.js';
import coachingRoutes from './coaching.js';

const router = Router();

// Health checks (no auth required)
router.use('/health', healthRoutes);

// Webhooks (no auth required - verified by signature)
router.use('/webhooks', webhooksRoutes);

// Attribution (no auth required - called from iOS before sign-in)
router.use('/api/attribution', attributionRoutes);

// Calendar OAuth callback (no auth required - browser redirect)
router.use('/api/calendar', calendarCallbackRouter);

// Internal worker routes (internal auth)
router.use('/internal/worker', meetingsWorkerRouter);

// API routes (require auth)
router.use('/api/recordings', recordingsRoutes);
router.use('/api/todos', todosRoutes);
router.use('/api/users', usersRoutes);
router.use('/api/meetings', meetingsRoutes);
router.use('/api/calendar', calendarRoutes);
router.use('/api/phone', phoneRoutes);
router.use('/api/subscriptions', subscriptionsRoutes);
router.use('/api/coaching', coachingRoutes);

export default router;
