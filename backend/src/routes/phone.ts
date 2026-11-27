/**
 * Phone call API for the app (/api/phone). The server decides everything: who has the feature, which numbers, whether a
 * call may be placed and for how long. Rules and spend limits: phone/ and migration 032.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError, Errors } from '../middleware/errorHandler.js';
import { phoneCallsApiGate, PHONE_CALLS_OFF_CODE, PHONE_CALLS_OFF_MESSAGE } from '../middleware/phoneCallsGate.js';
import { phoneVisibility, readClientCountries, TEST_DEVICE_HEADER, type Visibility } from '../phone/availability.js';
import { createLimiter } from '../services/activationEvents.js';
import { PhoneError, type PhoneDeps } from '../phone/deps.js';
import { getPhoneDeps } from '../phone/index.js';
import { safeError } from '../phone/gateway.js';
import { startVerification, verificationStatus, removeNumber, verifiedPhones } from '../phone/verification.js';
import { startCall, hangupCall, isUuid } from '../phone/calls.js';
import { hashNumber } from '../phone/numbers.js';
import { BUSINESS_ANSWERS, BUSINESS_TYPES, CALL_LANGUAGES, CONSENT_VERSION, MAX_VERIFIED_NUMBERS } from '../phone/constants.js';
import { CLIENT_STEPS, type PhoneStep } from '../phone/events.js';
import { verifySubscription, provisionPersonalNumber, endTrialByUser, isLive } from '../phone/provision.js';
import { setAgent, getAgent, removeAgent, fetchResultsOf } from '../phone/agents.js';
import type { PhoneExtras } from '../phone/deps.js';
import type { CallRow, PhoneRow } from '../phone/store.js';

const publicPhone = (p: PhoneRow) => ({ id: p.id, phone_number: p.phone_number, verified_at: p.verified_at, created_at: p.created_at });

const publicCall = (c: CallRow) => ({
  id: c.id, user_id: c.user_id, from_number: c.from_number, to_number: c.to_number, to_name: c.to_name, status: c.status,
  is_recording: c.status === 'recording', recording_duration: c.recording_duration, recording_id: c.recording_id,
  failure_reason: c.failure_reason, answered_at: c.answered_at, ended_at: c.ended_at, started_at: c.created_at, created_at: c.created_at,
  direction: c.direction === 'in' ? 'in' : 'out',
  // What the agent reported, when one took the call.
  agent: c.agent_result ? {
    summary: c.agent_result.summary, outcome: c.agent_result.outcome, ended_reason: c.agent_result.ended_reason,
    duration_seconds: c.agent_result.duration_seconds, transcript: c.agent_result.transcript, analysis: c.agent_result.analysis,
    collected: c.agent_result.collected ?? null,
  } : null,
});

export function createPhoneRouter(getDeps: () => PhoneDeps | null = getPhoneDeps, authMw: any = authenticate): Router {
  const router = Router();
  router.use(authMw);

  /** Whether this person is shown phone calls on this request, and under which country they are counted. */
  const visibility = (req: Request): Promise<Visibility | null> => {
    const userId = req.user!.id;
    return phoneVisibility(userId, readClientCountries((name) => req.get(name)), async () => {
      const d = getDeps();
      return !!d && verifiedPhones(await d.store.phonesOfUser(userId)).length > 0;
    });
  };
  const testDevice = (req: Request): boolean => req.get(TEST_DEVICE_HEADER) === '1' || req.body?.test === true;
  /** What the gate found, kept for the routes behind it. */
  const shownTo = new WeakMap<Request, Visibility>();

  /**
   * Counts the people who could see phone calls: one event per account, country and day (kept in memory, so a restart
   * may repeat one). Usage counts include only accounts that have this event (migration 035). Never delays the answer.
   */
  const counted = new Set<string>();
  const countSeen = (d: PhoneDeps, userId: string, v: Visibility, test: boolean): void => {
    const country = v.country ?? 'unknown';
    const key = `${new Date(d.now()).toISOString().slice(0, 10)}|${userId}|${country}|${test}`;
    if (counted.has(key)) return;
    if (counted.size >= 20_000) counted.clear();
    counted.add(key);
    void d.track('feature_seen', userId, { country, via: v.via, ...(test ? { test: true } : {}) });
  };
  const deps = () => {
    const d = getDeps();
    if (!d) throw new AppError(503, 'PHONE_NOT_CONFIGURED', 'Phone calls are not available right now.');
    return d;
  };
  const route = (fn: (req: Request, res: Response, d: PhoneDeps, userId: string) => Promise<void>) =>
    asyncHandler(async (req: Request, res: Response) => {
      try { await fn(req, res, deps(), req.user!.id); }
      catch (e) {
        if (e instanceof PhoneError) throw new AppError(e.status, e.code, e.message);
        if (e instanceof AppError) throw e;
        throw safeError(e);
      }
    });
  /** Signed in with a real account that is not blocked. */
  const eligible = async (d: PhoneDeps, userId: string): Promise<void> => {
    const info = await d.store.userInfo(userId);
    if (!info || info.isAnonymous || info.banned || !info.email) {
      throw new PhoneError(403, 'PHONE_ACCOUNT_NOT_ELIGIBLE', 'Sign in with an email, Google or Apple account to use phone calls.');
    }
  };

  /** Whether to show the Phone tab, and what it needs. Never refused: the app asks this on every start. */
  router.get('/status', asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    try {
      const shown = await visibility(req);
      const d = shown ? getDeps() : null;
      if (!shown || !d) return void res.json({ enabled: false });
      await sendStatus(res, d, userId);
      countSeen(d, userId, shown, testDevice(req));
    } catch (e) { throw safeError(e); }
  }));

  /** Whether the app shows the own-number screens: the trial or purchase is on, or the account already has a number. */
  const ownNumberShown = async (d: PhoneDeps, userId: string): Promise<boolean> => {
    const x = d.extras;
    if (!x) return false;
    if (x.plan().purchaseEnabled || (x.trialOn() && x.calldesk)) return true;
    try { return (await x.numbers.personalNumber(userId))?.status === 'active'; }
    catch { d.alert('OWN_NUMBER_CHECK_FAILED'); return false; }
  };

  const sendStatus = async (res: Response, d: PhoneDeps, userId: string): Promise<void> => {
    const phones = verifiedPhones(await d.store.phonesOfUser(userId));
    const budget = await d.store.budget(userId, phones[0] ? hashNumber(phones[0].phone_number, d.settings.numberHashKey) : null);
    res.json({
      enabled: true,
      own_number: await ownNumberShown(d, userId),
      consent_version: CONSENT_VERSION,
      countries: ['US', 'CA'],
      call_languages: CALL_LANGUAGES,
      max_verified_numbers: MAX_VERIFIED_NUMBERS,
      minutes_per_month: budget.minutes_per_month,
      minutes_left: budget.halted ? 0 : budget.minutes_left,
      service_available: !budget.halted && budget.month_spent_micro < budget.cap_micro,
      business_answered: await d.store.hasAnsweredBusiness(userId),
      phones: phones.map(publicPhone),
    });
  };

  // Removing one's own number works whenever the service is configured, also with the feature switched off.
  router.delete('/verified/:id', route(async (req, res, d, userId) => {
    if (!isUuid(req.params.id)) throw new PhoneError(404, 'PHONE_NUMBER_NOT_FOUND', 'Number not found.');
    await removeNumber(d, userId, req.params.id!);
    res.json({ deleted: true });
  }));

  // Ending the free trial gives the number back; like removing one's own number, it works with the feature switched off.
  router.delete('/number', route(async (_req, res, d, userId) => {
    if (!d.extras) throw new PhoneError(503, 'PHONE_NUMBERS_UNAVAILABLE', 'Your own number is not available yet.');
    await fetchResultsOf(d, d.extras, userId);
    res.json(await endTrialByUser(d, d.extras, userId));
  }));

  // Endpoints of app versions that predate the consent screen and carrier verification. Those versions send no country,
  // so phone calls are not available to them, and no released version could do better: never ask them to update.
  router.all(['/verify/send', '/verify/check', '/voip/token', '/calls/:id/record'], (_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError(404, PHONE_CALLS_OFF_CODE, PHONE_CALLS_OFF_MESSAGE));
  });

  // Hidden from this person (account switch, country, no verified number): nothing below runs then.
  router.use(phoneCallsApiGate(async (req) => {
    try {
      const shown = await visibility(req);
      if (shown) shownTo.set(req, shown);
      return !!shown;
    } catch (e) { throw safeError(e); }
  }));

  router.get('/verified', route(async (_req, res, d, userId) => {
    res.json({ phones: verifiedPhones(await d.store.phonesOfUser(userId)).map(publicPhone) });
  }));

  router.post('/verify/start', route(async (req, res, d, userId) => {
    await eligible(d, userId);
    res.status(201).json(await startVerification(d, userId, req.body?.phone_number));
  }));

  router.get('/verify/:id', route(async (req, res, d, userId) => {
    if (!isUuid(req.params.id)) throw new PhoneError(404, 'PHONE_VERIFICATION_NOT_FOUND', 'Verification not found.');
    const s = await verificationStatus(d, userId, req.params.id!);
    res.json({ status: s.status, reason: s.reason, phone: s.status === 'verified' && s.phone ? publicPhone(s.phone) : null });
  }));

  router.post('/calls', route(async (req, res, d, userId) => {
    await eligible(d, userId);
    res.status(201).json(await startCall(d, userId, req.body ?? {}));
  }));

  router.get('/calls', route(async (req, res, d, userId) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit), 10) || 50, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset), 10) || 0, 0);
    const { calls, total } = await d.store.listCalls(userId, limit, offset);
    res.json({ calls: calls.map(publicCall), total, limit, offset });
  }));

  router.get('/calls/:id', route(async (req, res, d, userId) => {
    const call = isUuid(req.params.id) ? await d.store.getCall(req.params.id!) : null;
    if (!call || call.user_id !== userId) throw new PhoneError(404, 'PHONE_CALL_NOT_FOUND', 'Call not found.');
    res.json({ call: publicCall(call) });
  }));

  router.post('/calls/:id/hangup', route(async (req, res, d, userId) => {
    await hangupCall(d, userId, req.params.id!);
    res.json({ ended: true });
  }));

  const limiter = createLimiter();
  const limited = (userId: string) => {
    if (!limiter.take(userId, 1, 60, 3_600_000)) throw new PhoneError(429, 'RATE_LIMITED', 'Too many requests');
  };
  router.post('/events', route(async (req, res, d, userId) => {
    limited(userId);
    const step = req.body?.step as PhoneStep;
    if (!CLIENT_STEPS.includes(step)) throw Errors.badRequest('Unknown step');
    await d.track(step, userId, { country: shownTo.get(req)?.country, ...(testDevice(req) ? { test: true } : {}) });
    res.status(204).end();
  }));

  /** "Is this for a business?" Skippable; stored only as a funnel event. */
  router.post('/profile', route(async (req, res, d, userId) => {
    limited(userId);
    const answer = req.body?.business;
    if (!BUSINESS_ANSWERS.includes(answer)) throw Errors.badRequest('Unknown answer');
    const type = answer === 'business' && BUSINESS_TYPES.includes(req.body?.business_type) ? req.body.business_type : undefined;
    await d.track('business_answer', userId, {
      answer, business_type: type, context: req.body?.context === 'agent' ? 'agent' : 'number',
      country: shownTo.get(req)?.country, ...(testDevice(req) ? { test: true } : {}),
    });
    res.status(204).end();
  }));

  // ---- Numbers, subscription and agent (migration 033; absent until PHONE_NUMBERS_SCHEMA is on) ----
  const extra = (fn: (req: Request, res: Response, d: PhoneDeps, x: PhoneExtras, userId: string) => Promise<void>) =>
    route(async (req, res, d, userId) => {
      if (!d.extras) throw new PhoneError(503, 'PHONE_NUMBERS_UNAVAILABLE', 'Your own number is not available yet.');
      await eligible(d, userId);
      await fn(req, res, d, d.extras, userId);
    });

  /** What the account has, and what it can get: the free trial or a purchase. Amounts come from the server. */
  router.get('/plan', extra(async (_req, res, d, x, userId) => {
    const plan = x.plan();
    const sub = await x.numbers.subscription(userId);
    const number = await x.numbers.personalNumber(userId);
    const live = isLive(sub, d.now());
    let trial = null;
    if (x.trialOn() && !live) {
      const state = await x.numbers.trialState(userId);
      const limits = await x.numbers.trialLimits();
      trial = {
        offered: !state && !!x.calldesk,
        days: limits.days,
        agent_minutes: limits.agentMinutes,
        active: state?.running ? { ends_at: state.ends_at, agent_minutes_left: Math.floor(state.seconds_left / 60) } : null,
        used: !!state && !state.running,
      };
    }
    res.json({
      purchase_enabled: plan.purchaseEnabled,
      product_id: plan.purchaseEnabled ? plan.productId : null,
      price_label: plan.purchaseEnabled ? plan.priceLabel || null : null,
      call_minutes: plan.callMinutes,
      agent_minutes: plan.agentMinutes,
      subscription: live ? {
        expires_at: sub.expires_at,
        call_minutes_left: Math.floor((await x.numbers.subLeft(userId, 'call')) / 60),
        agent_minutes_left: Math.floor((await x.numbers.subLeft(userId, 'agent')) / 60),
      } : null,
      trial,
      number: number?.status === 'active' ? { id: number.id, phone_number: number.phone_number, country: number.country } : null,
      agents_available: !!x.calldesk && (live || !!trial?.active),
      agent: number?.agent_id ? { description: number.agent_description, language: number.agent_language } : null,
    });
  }));

  router.get('/agent/languages', extra(async (_req, res, _d, x) => {
    if (!x.calldesk) throw new PhoneError(503, 'PHONE_AGENT_UNAVAILABLE', 'Agents are not available right now.');
    res.json({ languages: await x.calldesk.languages() });
  }));

  router.post('/subscription', extra(async (req, res, d, x, userId) => {
    const row = await verifySubscription(d, x, userId, req.body ?? {});
    res.status(201).json({ expires_at: row.expires_at, call_minutes: row.call_seconds / 60, agent_minutes: row.agent_seconds / 60 });
  }));

  router.post('/number', extra(async (req, res, d, x, userId) => {
    const n = await provisionPersonalNumber(d, x, userId, req.body ?? {});
    res.status(201).json({ id: n.id, phone_number: n.phone_number, country: n.country });
  }));

  router.get('/agent', extra(async (_req, res, d, x, userId) => { res.json(await getAgent(d, x, userId)); }));
  router.put('/agent', extra(async (req, res, d, x, userId) => { res.json(await setAgent(d, x, userId, req.body ?? {})); }));
  router.delete('/agent', extra(async (_req, res, d, x, userId) => { await removeAgent(d, x, userId); res.json({ deleted: true }); }));

  return router;
}

export default createPhoneRouter();
