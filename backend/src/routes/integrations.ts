/**
 * Integrations API (webhook / Slack / Notion). Secrets are write-only.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import {
  INTEGRATION_KINDS,
  deleteIntegration,
  listDeliveries,
  listIntegrations,
  publicView,
  sendTest,
  StoredSecretUnreadableError,
  upsertIntegration,
  type IntegrationKind,
} from '../services/integrationsService.js';

const router = Router();
router.use(authenticate);

const kindSchema = z.enum(INTEGRATION_KINDS as [IntegrationKind, ...IntegrationKind[]]);

const upsertSchema = z.object({
  url: z.string().max(2000).optional(),
  secret: z.string().max(500).optional(),
  database_id: z.string().max(64).optional(),
  enabled: z.boolean().optional(),
});

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await listIntegrations(req.user!.id);
    res.json({ integrations: rows.map(publicView) });
  })
);

router.get(
  '/deliveries',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ deliveries: await listDeliveries(req.user!.id) });
  })
);

router.put(
  '/:kind',
  asyncHandler(async (req: Request, res: Response) => {
    const kind = kindSchema.parse(req.params.kind);
    const body = upsertSchema.parse(req.body);
    try {
      const row = await upsertIntegration(req.user!.id, kind, body);
      res.json({ integration: publicView(row) });
    } catch (e) {
      if (e instanceof StoredSecretUnreadableError) throw Errors.conflict(e.message);
      if (e instanceof Error && (e.name === 'SsrfError' || /required|must be|valid/.test(e.message))) {
        throw Errors.badRequest(e.message);
      }
      throw e;
    }
  })
);

router.delete(
  '/:kind',
  asyncHandler(async (req: Request, res: Response) => {
    await deleteIntegration(req.user!.id, kindSchema.parse(req.params.kind));
    res.status(204).end();
  })
);

router.post(
  '/:kind/test',
  asyncHandler(async (req: Request, res: Response) => {
    const kind = kindSchema.parse(req.params.kind);
    const r = await sendTest(req.user!.id, kind);
    res.json({ ok: r.ok, response_status: r.responseStatus ?? null, error: r.error ?? null });
  })
);

export default router;
