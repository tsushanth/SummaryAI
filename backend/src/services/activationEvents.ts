/**
 * Pure rules for the first-party activation funnel (landed -> signup -> first recording -> summary viewed).
 * No imports from supabase/config so it is unit-testable. Modelled on RiddleVerse's puzzle_events ingest
 * (allow-listed names, validated payload, in-memory sliding-window limiter per IP and per anonymous id).
 *
 * Privacy: events carry an anonymous random id, an allow-listed name and a few numbers/booleans/short enums.
 * Free text, URLs, emails, titles and transcripts are never accepted; IPs and user agents are never stored.
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
const NAME_SET = new Set<string>(ACTIVATION_EVENT_NAMES);

export const ANON_ID_RE = /^[a-z0-9-]{16,64}$/i;
const PROP_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const PROP_ENUM_RE = /^[a-z0-9._:-]{1,40}$/i;
const VERSION_RE = /^[a-z0-9._+-]{1,20}$/i;
export const PLATFORMS = new Set(['web', 'android', 'ios']);
export const MAX_PROP_KEYS = 8;

export const IP_LIMIT = { limit: 60, windowMs: 60_000 };
export const ANON_LIMIT = { limit: 300, windowMs: 3_600_000 };

export interface ActivationEventRow {
  anon_id: string;
  user_id: string | null;
  name: ActivationEventName;
  props: Record<string, number | boolean | string>;
  platform: string;
  app_version: string | null;
}

/** Keeps numbers, booleans and short enum strings; silently drops everything else. At most 8 keys. */
export function sanitizeProps(raw: unknown): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROP_KEYS) break;
    if (!PROP_KEY_RE.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && PROP_ENUM_RE.test(v)) out[k] = v;
  }
  return out;
}

/** Returns the row to insert, or null when the payload is not a valid event (caller answers 400). */
export function validateEvent(body: unknown, userId: string | null): ActivationEventRow | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.anon_id !== 'string' || !ANON_ID_RE.test(b.anon_id)) return null;
  if (typeof b.name !== 'string' || !NAME_SET.has(b.name)) return null;
  const platform = typeof b.platform === 'string' && PLATFORMS.has(b.platform) ? b.platform : 'web';
  const app_version = typeof b.app_version === 'string' && VERSION_RE.test(b.app_version) ? b.app_version : null;
  return { anon_id: b.anon_id, user_id: userId, name: b.name as ActivationEventName, props: sanitizeProps(b.props), platform, app_version };
}

/** In-memory sliding-window limiter (single Fly machine scale; resets on restart). */
export function createLimiter({ now = () => Date.now(), maxKeys = 50_000 } = {}) {
  const hits = new Map<string, { t: number; n: number }[]>();
  return {
    /** Consume n units for key; false (and nothing consumed) if it would exceed limit in windowMs. */
    take(key: string, n: number, limit: number, windowMs: number): boolean {
      const t = now();
      const arr = (hits.get(key) ?? []).filter((h) => t - h.t < windowMs);
      const used = arr.reduce((s, h) => s + h.n, 0);
      if (used + n > limit) { hits.set(key, arr); return false; }
      arr.push({ t, n });
      hits.set(key, arr);
      if (hits.size > maxKeys) {
        for (const [k, v] of hits) if (!v.length || t - v[v.length - 1].t > 3_600_000) hits.delete(k);
      }
      return true;
    },
    size: () => hits.size,
  };
}

export interface AttributionRow {
  user_id: string;
  anon_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referrer_host: string | null;
  landing_path: string | null;
  platform: string;
}

const clean = (v: unknown, max: number, re: RegExp): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().slice(0, max);
  return s && re.test(s) ? s : null;
};

/** Short [a-z0-9._-] strings only; the landing path is a bare path (no query string, no fragment). Null when nothing usable is left. */
export function validateAttribution(body: unknown, userId: string): AttributionRow | null {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const tag = /^[a-z0-9._-]+$/;
  const row: AttributionRow = {
    user_id: userId,
    anon_id: typeof b.anon_id === 'string' && ANON_ID_RE.test(b.anon_id) ? b.anon_id : null,
    utm_source: clean(b.utm_source, 64, tag),
    utm_medium: clean(b.utm_medium, 64, tag),
    utm_campaign: clean(b.utm_campaign, 64, tag),
    referrer_host: clean(b.referrer_host, 100, /^[a-z0-9.-]+$/),
    landing_path: clean(b.landing_path, 64, /^\/[a-z0-9/_-]*$/),
    platform: typeof b.platform === 'string' && PLATFORMS.has(b.platform) ? b.platform : 'web',
  };
  const any = row.anon_id || row.utm_source || row.utm_medium || row.utm_campaign || row.referrer_host || row.landing_path;
  return any ? row : null;
}
