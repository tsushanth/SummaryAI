/**
 * Startup configuration check. A missing provider secret does not stop the server: processing silently falls back to a
 * MOCK transcript/summary, and webhooks accept unsigned requests. Raise one alert per boot instead (production only).
 * Names only; secret values are never read into the message.
 */
import { reportAlert } from './alerts.js';

/** Without these the product is broken or insecure. */
export const REQUIRED_IN_PRODUCTION = [
  'DEEPGRAM_API_KEY',
  'ANTHROPIC_API_KEY',
  'RECALL_API_KEY',
  'RECALL_WEBHOOK_SECRET',
  'ENCRYPTION_KEY',
  'INTERNAL_SECRET',
  'SERVICE_URL',
  'RESEND_API_KEY',
] as const;

/**
 * Features that fail on use when unset (billing, phone, calendar). REVENUECAT_WEBHOOK_AUTH_HEADER is deliberately not
 * listed: MeetingMind does not use RevenueCat (iOS = StoreKit 2, Android = Play billing + RTDN), and the webhook route
 * rejects every request when it is unset.
 */
export const FEATURE_SECRETS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'GOOGLE_PLAY_SA_JSON',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
] as const;

export function findMissingConfig(env: NodeJS.ProcessEnv = process.env): { required: string[]; features: string[] } {
  const missing = (names: readonly string[]) => names.filter((n) => !env[n] || !String(env[n]).trim());
  return { required: missing(REQUIRED_IN_PRODUCTION), features: missing(FEATURE_SECRETS) };
}

/**
 * OAuth redirect URIs that do not point at this server's calendar callback. The provider sends the user to that address
 * after consent, so a stale one fails every connection without this server ever seeing a request (GOOGLE_REDIRECT_URI kept
 * pointing at a deleted Cloud Run service after the move to Fly). The values are public, but only hosts are reported.
 */
export function findBadRedirectUris(env: NodeJS.ProcessEnv = process.env): Array<{ name: string; host: string }> {
  let serviceHost: string;
  try { serviceHost = new URL(String(env.SERVICE_URL)).host; } catch { return []; } // missing SERVICE_URL is reported above
  const bad: Array<{ name: string; host: string }> = [];
  for (const [name, provider] of [['GOOGLE_REDIRECT_URI', 'google'], ['MICROSOFT_REDIRECT_URI', 'microsoft']] as const) {
    const value = env[name]?.trim();
    if (!value) continue;
    let url: URL | null = null;
    try { url = new URL(value); } catch { /* unparseable is bad */ }
    const ok = !!url && url.host === serviceHost && new RegExp(`^(/v\\d+)?/api/calendar/callback/${provider}$`).test(url.pathname);
    if (!ok) bad.push({ name, host: url?.host ?? 'unparseable' });
  }
  return bad;
}

export function checkStartupConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  for (const { name, host } of findBadRedirectUris(env)) {
    console.error(`[startup] ${name} does not point at this server's calendar callback (host ${host})`);
    reportAlert('startup_config', `BAD_${name}`, { host }, 60 * 60_000);
  }
  const { required, features } = findMissingConfig(env);
  if (required.length) {
    console.error(`[startup] missing required secrets: ${required.join(', ')}`);
    reportAlert('startup_config', 'MISSING_REQUIRED_SECRETS', { missing: required.join(',') }, 60 * 60_000);
  }
  if (features.length) {
    console.warn(`[startup] missing feature secrets: ${features.join(', ')}`);
    reportAlert('startup_config', 'MISSING_FEATURE_SECRETS', { missing: features.join(',') }, 60 * 60_000);
  }
}
