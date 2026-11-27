/**
 * Carrier webhooks of the calls subaccount (mounted at /webhooks/twilio). Every one requires the carrier's signature made
 * with the subaccount's auth token over the exact public URL; anything else is refused with 403, whether phone calls are
 * on or off. No request body or number is ever logged here.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { PhoneDeps } from '../phone/deps.js';
import { getPhoneDeps } from '../phone/index.js';
import { safeError } from '../phone/gateway.js';
import { answerAppCall, calleeNotice, settleCall, isUuid } from '../phone/calls.js';
import { ingestRecording } from '../phone/recordings.js';
import { handleCallerIdStatus } from '../phone/verification.js';

const xml = (res: Response, body: string) => { res.type('text/xml').send(body); };
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

export function createPhoneWebhookRouter(getDeps: () => PhoneDeps | null = getPhoneDeps): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    const d = getDeps();
    const signature = req.get('x-twilio-signature') ?? '';
    const params = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>;
    if (!d || req.method !== 'POST' || !d.gateway.isValidRequest(signature, `${d.settings.publicBaseUrl}${req.originalUrl}`, params)) {
      // A signed request that fails here means a wrong token or public URL: every call would fail. Unsigned noise is not alerted.
      if (d && signature) d.alert('WEBHOOK_SIGNATURE_REJECTED');
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid signature' } });
      return;
    }
    res.locals.phone = d;
    next();
  });

  const params = (req: Request) => req.body as Record<string, string>;
  const deps = (res: Response) => res.locals.phone as PhoneDeps;
  const query = (req: Request, name: string) => (typeof req.query[name] === 'string' ? (req.query[name] as string) : '');
  /** Failures answer 500 so they are reported; the sweeper repairs what a lost callback left behind. */
  const handle = (fn: (req: Request, res: Response, d: PhoneDeps) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, deps(res)).catch((e) => next(safeError(e)));
  };

  router.post('/voip-outbound', handle(async (req, res, d) => xml(res, await answerAppCall(d, params(req)))));

  router.post('/callee-notice', handle(async (req, res, d) => xml(res, await calleeNotice(d, query(req, 'cid'), params(req)))));

  router.post('/dial-complete', handle(async (req, res, d) => {
    const callId = query(req, 'cid');
    // The app leg ends right after this answer; give the carrier a moment to finalise both legs.
    if (isUuid(callId)) d.later(8_000, () => settleCall(d, callId));
    xml(res, EMPTY_TWIML);
  }));

  // Status callback of the TwiML app: the app leg ended, whatever happened before.
  router.post('/call-status', handle(async (req, res, d) => {
    const { CallSid, CallStatus } = params(req);
    if (CallSid && CallStatus === 'completed') {
      const call = await d.store.callBySid(CallSid);
      if (call) d.later(5_000, () => settleCall(d, call.id));
    }
    res.status(204).end();
  }));

  router.post('/recording-complete', handle(async (req, res, d) => {
    const p = params(req);
    const callId = query(req, 'cid');
    // Answer at once; saving a long recording can outlast the carrier's timeout.
    d.later(0, () => ingestRecording(d, callId, {
      sid: p.RecordingSid ?? '', callSid: p.CallSid ?? '', status: p.RecordingStatus ?? '', durationSeconds: Number(p.RecordingDuration) || 0,
    }));
    res.status(204).end();
  }));

  router.post('/caller-id-status', handle(async (req, res, d) => {
    const id = query(req, 'vid');
    if (isUuid(id)) await handleCallerIdStatus(d, id, params(req));
    res.status(204).end();
  }));

  // The carrier's own spending alarm on the subaccount: stops all calls for the rest of the month.
  router.post('/usage-alarm', handle(async (_req, res, d) => {
    await d.store.halt('carrier_usage_alarm');
    d.alert('CARRIER_USAGE_ALARM');
    res.status(204).end();
  }));

  return router;
}

export default createPhoneWebhookRouter();
