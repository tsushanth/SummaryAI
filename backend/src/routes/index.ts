/**
 * Route aggregator
 */

import { Router } from 'express';
import healthRoutes from './health.js';
import recordingsRoutes from './recordings.js';
import todosRoutes from './todos.js';
import intelligenceRoutes from './intelligence.js';
import usersRoutes from './users.js';
import meetingsRoutes, { meetingsWorkerRouter } from './meetings.js';
import calendarRoutes, { calendarCallbackRouter } from './calendar.js';
import webhooksRoutes from './webhooks.js';
import phoneRoutes from './phone.js';
import subscriptionsRoutes from './subscriptions.js';
import attributionRoutes from './attribution.js';
import coachingRoutes from './coaching.js';
import { foldersRouter, tagsRouter } from './folders.js';
import { recordingSharesRouter, publicSharesRouter } from './shares.js';
import { summaryEmailRouter } from './summaryEmail.js';
import searchRoutes from './search.js';
import integrationsRoutes from './integrations.js';
import statsRoutes from './stats.js';

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

// Public share links (no auth - unguessable token, rate limited)
router.use('/api/public/shares', publicSharesRouter);

// API routes (require auth)
router.use('/api', intelligenceRoutes);
router.use('/api/recordings/:id/shares', recordingSharesRouter);
router.use('/api/recordings/:id/email-summary', summaryEmailRouter);
router.use('/api/folders', foldersRouter);
router.use('/api/tags', tagsRouter);
router.use('/api/search', searchRoutes);
router.use('/api/recordings', recordingsRoutes);
router.use('/api/todos', todosRoutes);
router.use('/api/users', usersRoutes);
router.use('/api/meetings', meetingsRoutes);
router.use('/api/calendar', calendarRoutes);
router.use('/api/phone', phoneRoutes);
router.use('/api/subscriptions', subscriptionsRoutes);
router.use('/api/coaching', coachingRoutes);
router.use('/api/integrations', integrationsRoutes);
router.use('/api/stats', statsRoutes);

export default router;
