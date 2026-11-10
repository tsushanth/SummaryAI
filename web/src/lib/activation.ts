/**
 * Pure helpers for the first-party activation funnel. No runtime imports so node can load this file directly
 * (see scripts/activation.test.mjs). The browser emitter is activationClient.ts; the backend contract is
 * backend/src/services/activationEvents.ts (keep ACTIVATION_EVENT_NAMES identical).
 *
 * Privacy: anonymous random id in localStorage (no cookies), allow-listed event names, numbers / booleans / short enums only.
 * Nothing is sent when the browser says Do Not Track or Global Privacy Control, or unless NEXT_PUBLIC_ACTIVATION_EVENTS=1.
 */

export const ACTIVATION_EVENT_NAMES = [
  'landed',
  'signup_started',
  'signup_done',
  'record_clicked',
  'first_recording_started',
  'first_recording_done',
  'summary_viewed',
  'sample_viewed',
  'upload_chosen',
] as const;
export type ActivationEventName = (typeof ACTIVATION_EVENT_NAMES)[number];

export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue>;

/** Minimal Storage shape (localStorage / sessionStorage / a test fake). */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

const ANON_RE = /^[a-z0-9-]{16,64}$/i;
const TAG_RE = /^[a-z0-9._-]+$/;
const ENUM_RE = /^[a-z0-9._:-]{1,40}$/i;

export const ANON_KEY = 'mm_act_anon';
export const ATTRIBUTION_KEY = 'mm_act_attr';
export const FIRST_KEY = 'mm_act_first';
export const SIGNUP_DONE_KEY = 'mm_act_signup_done';

export function isValidAnonId(v: unknown): v is string {
  return typeof v === 'string' && ANON_RE.test(v);
}

/** A random v4-style id. `rand` is injectable for tests. */
export function newAnonId(rand: () => string = () => globalThis.crypto.randomUUID()): string {
  const id = rand();
  if (!isValidAnonId(id)) throw new Error('anon id generator returned an invalid id');
  return id;
}

/** Existing id from storage, else a fresh one that is stored. Falls back to a throwaway id if storage is unusable. */
export function getOrCreateAnonId(store: KV | null, rand?: () => string): string {
  try {
    const cur = store?.getItem(ANON_KEY);
    if (isValidAnonId(cur)) return cur;
    const id = newAnonId(rand);
    store?.setItem(ANON_KEY, id);
    return id;
  } catch {
    return newAnonId(rand);
  }
}

/** Do Not Track / Global Privacy Control => do not emit anything. */
export function trackingAllowed(opts: { flag?: string | undefined; doNotTrack?: string | null; gpc?: boolean | undefined }): boolean {
  if (opts.flag !== '1') return false;
  if (opts.doNotTrack === '1' || opts.doNotTrack === 'yes') return false;
  if (opts.gpc === true) return false;
  return true;
}

const tag = (v: string | null | undefined, max: number): string | undefined => {
  if (!v) return undefined;
  const s = v.trim().toLowerCase().slice(0, max);
  return s && TAG_RE.test(s) ? s : undefined;
};

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer_host?: string;
  landing_path?: string;
}

/** utm_* from a location.search string and the referrer's host (own host and empty referrers are dropped). */
export function parseUtm(search: string, referrer: string, ownHost = '', landingPath = ''): Attribution {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out: Attribution = {};
  const s = tag(q.get('utm_source'), 64), m = tag(q.get('utm_medium'), 64), c = tag(q.get('utm_campaign'), 64);
  if (s) out.utm_source = s;
  if (m) out.utm_medium = m;
  if (c) out.utm_campaign = c;
  if (referrer) {
    try {
      const host = new URL(referrer).hostname.toLowerCase();
      if (host && host !== ownHost.toLowerCase() && /^[a-z0-9.-]+$/.test(host)) out.referrer_host = host.slice(0, 100);
    } catch { /* not a URL */ }
  }
  if (/^\/[a-z0-9/_-]*$/i.test(landingPath) && landingPath.length <= 64) out.landing_path = landingPath.toLowerCase();
  return out;
}

/** First touch wins: stored attribution is returned unchanged; a fresh one is stored only when it has any field. */
export function rememberAttribution(store: KV | null, fresh: Attribution): Attribution {
  try {
    const raw = store?.getItem(ATTRIBUTION_KEY);
    if (raw) { const cur = JSON.parse(raw); if (cur && typeof cur === 'object') return cur as Attribution; }
    if (Object.keys(fresh).length) store?.setItem(ATTRIBUTION_KEY, JSON.stringify(fresh));
  } catch { /* storage unusable */ }
  return fresh;
}

/** Attribution fields as event props: short enums only (the backend drops anything longer than 40). */
export function attributionProps(a: Attribution): Props {
  const out: Props = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'referrer_host'] as const) {
    const v = a[k];
    if (v && ENUM_RE.test(v)) out[k] = v;
  }
  return out;
}

export interface BuiltEvent { anon_id: string; name: ActivationEventName; props: Props; platform: 'web'; app_version?: string }

/** Throws on a name that is not on the allow-list (a programming error, caught by the emitter). */
export function buildEvent(name: string, anonId: string, props: Props = {}, appVersion?: string): BuiltEvent {
  if (!(ACTIVATION_EVENT_NAMES as readonly string[]).includes(name)) throw new Error(`unknown activation event: ${name}`);
  if (!isValidAnonId(anonId)) throw new Error('invalid anon id');
  const clean: Props = {};
  for (const [k, v] of Object.entries(props)) {
    if (Object.keys(clean).length >= 8) break;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) clean[k] = Math.round(v * 100) / 100;
    else if (typeof v === 'boolean') clean[k] = v;
    else if (typeof v === 'string' && ENUM_RE.test(v)) clean[k] = v;
  }
  return { anon_id: anonId, name: name as ActivationEventName, props: clean, platform: 'web', ...(appVersion ? { app_version: appVersion } : {}) };
}

/** True the first time for a key, false afterwards (dedupes landed / signup_done across remounts). */
export function shouldEmitOnce(store: KV | null, key: string): boolean {
  try {
    if (store?.getItem(key)) return false;
    store?.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
}

/**
 * "First recording" without a new API call. The recordings list page already loads the user's recordings: when it sees a
 * real (unfiltered) empty list it marks the user as pre-first-recording; any non-empty list clears the mark. The
 * new-recording page reads the mark. Approximation: a user who opens /recordings/new before ever loading the list is not counted.
 */
export function observeRecordingsList(store: KV | null, count: number, filtered: boolean): void {
  try {
    if (filtered) return;
    if (count > 0) store?.setItem(FIRST_KEY, '0');
    else if (store?.getItem(FIRST_KEY) !== '0') store?.setItem(FIRST_KEY, '1');
  } catch { /* storage unusable */ }
}
export const isFirstRecording = (store: KV | null): boolean => {
  try { return store?.getItem(FIRST_KEY) === '1'; } catch { return false; }
};
export const markFirstRecordingDone = (store: KV | null): void => {
  try { store?.setItem(FIRST_KEY, '0'); } catch { /* storage unusable */ }
};

/** A user created this recently counts as a fresh signup (the dashboard emits signup_done once for them). */
export function isFreshSignup(createdAt: string | undefined, now = Date.now(), windowMs = 15 * 60_000): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(t) && now - t >= -60_000 && now - t <= windowMs;
}

/** Summary tab state for summary_viewed: a real summary, or why there is none. */
export function summaryViewedState(kind: string): string | null {
  return kind === 'summary' ? 'ok' : kind === 'too_short' || kind === 'no_speech' ? kind : null;
}
