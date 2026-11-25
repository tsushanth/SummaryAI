/**
 * Reports outreach-attributed signups and first activations to the shared outreach metrics layer
 * (Calldesk: POST /api/outreach/event, contract in the Calldesk repo docs/OUTREACH-METRICS.md).
 *
 * OFF by default: nothing happens unless OUTREACH_EVENTS_URL is set to the endpoint (https) AND a secret is present
 * (OUTREACH_EVENT_SECRET_MEETINGMIND, else the shared OUTREACH_EVENT_SECRET). Only users whose first touch was an outreach link
 * (utm_source=outreach with a valid utm_campaign) are ever reported; everyone else is ignored before any network or DB work.
 *
 * Safety rules, all enforced here:
 *  - fire and forget: callers never await the network call, a 2 second timeout per attempt, one background retry for
 *    network errors / 5xx / 429, every error swallowed;
 *  - one log line per outcome with the event name, campaign slug and HTTP status. Never an email, user id or code;
 *  - the email goes only in the signed request body to the metrics layer, which hashes it with its own pepper and never stores it.
 */
import { createHmac } from 'node:crypto';

export const OUTREACH_PRODUCT = 'meetingmind';
export type OutreachEventName = 'signup' | 'activated';

const CAMPAIGN_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TIMEOUT_MS = 2000;
const RETRY_DELAY_MS = 2000;

export interface OutreachAttribution {
  campaign: string;
  linkCode: string | null;
}

/** The outreach attribution in a first-touch utm set, or null when the visitor did not come from an outreach link. */
export function outreachAttribution(src: { utm_source?: unknown; utm_campaign?: unknown; utm_content?: unknown } | null | undefined): OutreachAttribution | null {
  if (!src) return null;
  const source = typeof src.utm_source === 'string' ? src.utm_source.trim().toLowerCase() : '';
  const campaign = typeof src.utm_campaign === 'string' ? src.utm_campaign.trim().toLowerCase() : '';
  if (source !== 'outreach' || !CAMPAIGN_RE.test(campaign)) return null;
  const code = typeof src.utm_content === 'string' ? src.utm_content.trim() : '';
  return { campaign, linkCode: CODE_RE.test(code) ? code : null };
}

export interface OutreachConfig {
  url: string;
  secret: string;
}

let warnedMissingSecret = false;

/** The endpoint and signing secret, or null while the feature is off or half-configured. */
export function outreachConfig(env: NodeJS.ProcessEnv = process.env): OutreachConfig | null {
  const url = (env.OUTREACH_EVENTS_URL ?? '').trim();
  if (!url) return null;
  if (!/^https:\/\/[^\s/]+/i.test(url)) return null;
  const secret = (env[`OUTREACH_EVENT_SECRET_${OUTREACH_PRODUCT.toUpperCase()}`] || env.OUTREACH_EVENT_SECRET || '').trim();
  if (!secret) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn('[outreach] OUTREACH_EVENTS_URL is set but no event secret is; outreach events stay off');
    }
    return null;
  }
  return { url, secret };
}

export const outreachEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => outreachConfig(env) !== null;

export interface SendDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
  retryDelayMs?: number;
}

export interface OutreachEventInput {
  event: OutreachEventName;
  attribution: OutreachAttribution;
  email: string;
  meta?: Record<string, string | number | boolean>;
}

/** Signs and posts one event. Resolves to the outcome; never rejects. Exported for tests: callers use reportOutreachEvent. */
export async function sendOutreachEvent(input: OutreachEventInput, deps: SendDeps = {}): Promise<'sent' | 'skipped' | 'failed'> {
  const log = deps.log ?? ((l: string) => console.log(l));
  try {
    const cfg = outreachConfig(deps.env ?? process.env);
    if (!cfg) return 'skipped';
    const email = (input.email ?? '').trim();
    if (!email || !email.includes('@')) return 'skipped';
    const fetchImpl = deps.fetchImpl ?? fetch;
    const now = deps.now ?? Date.now;
    const body: Record<string, unknown> = {
      product: OUTREACH_PRODUCT,
      campaign: input.attribution.campaign,
      event: input.event,
      email,
      ts: new Date(now()).toISOString(),
    };
    if (input.attribution.linkCode) body.link_code = input.attribution.linkCode;
    if (input.meta) body.meta = input.meta;
    const raw = JSON.stringify(body);

    const attempt = async (): Promise<{ status: number } | { error: string }> => {
      const ts = String(Math.floor(now() / 1000));
      const sig = 'v1=' + createHmac('sha256', cfg.secret).update(`${ts}.${raw}`).digest('hex');
      try {
        const res = await fetchImpl(cfg.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-outreach-product': OUTREACH_PRODUCT, 'x-outreach-timestamp': ts, 'x-outreach-signature': sig },
          body: raw,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return { status: res.status };
      } catch (e) {
        return { error: (e as Error)?.name || 'error' };
      }
    };
    const retryable = (r: { status: number } | { error: string }) => 'error' in r || r.status >= 500 || r.status === 429;

    let r = await attempt();
    if (retryable(r)) {
      await new Promise((resolve) => { const t = setTimeout(resolve, deps.retryDelayMs ?? RETRY_DELAY_MS); (t as { unref?: () => void }).unref?.(); });
      r = await attempt();
    }
    const ok = 'status' in r && r.status >= 200 && r.status < 300;
    log(`[outreach] ${input.event} campaign=${input.attribution.campaign} ${'status' in r ? `status=${r.status}` : `error=${r.error}`}`);
    return ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Fire and forget. Returns immediately; does nothing while the feature is off. */
export function reportOutreachEvent(input: OutreachEventInput, deps: SendDeps = {}): void {
  if (!outreachConfig(deps.env ?? process.env)) return;
  void sendOutreachEvent(input, deps).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------------------------
// Activation: first recording completed
// ---------------------------------------------------------------------------------------------------------------------

export interface ActivationLookups {
  /** First-touch outreach attribution for the user, or null. */
  getAttribution(userId: string): Promise<OutreachAttribution | null>;
  getEmail(userId: string): Promise<string | null>;
}

const MAX_SEEN = 20_000;
const seen = new Set<string>();

/** Test hook. */
export function resetOutreachActivationCache(): void { seen.clear(); }

/**
 * Called when a recording finishes processing. Fire and forget (the caller must not await it). At most one lookup per user
 * per process, and the metrics layer itself keeps one `activated` row per user and campaign, so a repeat is harmless.
 */
export function reportActivationForUser(userId: string | null | undefined, lookups: ActivationLookups, deps: SendDeps = {}): void {
  if (!userId || !outreachConfig(deps.env ?? process.env) || seen.has(userId)) return;
  if (seen.size >= MAX_SEEN) seen.clear();
  seen.add(userId);
  void (async () => {
    try {
      const attribution = await lookups.getAttribution(userId);
      if (!attribution) return;
      const email = await lookups.getEmail(userId);
      if (!email) return;
      await sendOutreachEvent({ event: 'activated', attribution, email, meta: { milestone: 'first_recording_completed' } }, deps);
    } catch {
      // swallowed on purpose: activation reporting must never affect processing
    }
  })();
}
