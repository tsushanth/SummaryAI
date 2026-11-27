/**
 * Phone call constants. Spend limits and rate limits are NOT here: they live in the database function phone_limits()
 * (supabase/migrations/032_phone_calls_repair.sql), the only place that can enforce them.
 */

/**
 * Every word spoken on a recorded call. Both sides hear it before they can talk to each other: the app user before the
 * number is dialled, the called person after answering and before being connected.
 * PROPOSED WORDING, NOT YET APPROVED BY THE OWNER: calling stays switched off until it is.
 * A call in Spanish or French speaks that language first and English second.
 */
export const RECORDING_NOTICE = {
  en: { text: 'This call is being recorded.', language: 'en-US', voice: 'Polly.Joanna' },
  es: { text: 'Esta llamada se está grabando.', language: 'es-US', voice: 'Polly.Lupe' },
  fr: { text: 'Cet appel est enregistré.', language: 'fr-CA', voice: 'Polly.Chantal' },
} as const;

export type CallLanguage = keyof typeof RECORDING_NOTICE;
export const CALL_LANGUAGES = Object.keys(RECORDING_NOTICE) as CallLanguage[];

export const asCallLanguage = (v: unknown): CallLanguage =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(RECORDING_NOTICE, v) ? (v as CallLanguage) : 'en';

/** The notice(s) to speak, in order. */
export function noticesFor(language: unknown): (typeof RECORDING_NOTICE)[CallLanguage][] {
  const l = asCallLanguage(language);
  return l === 'en' ? [RECORDING_NOTICE.en] : [RECORDING_NOTICE[l], RECORDING_NOTICE.en];
}

/** Version of the consent screen the app must have shown before a call. Bump when its meaning changes. */
export const CONSENT_VERSION = 'phone-recording-1';

export const RING_TIMEOUT_SECONDS = 30;
/** Taken off the dial time limit so the called leg, including the notice it hears, stays within the reserved minutes. */
export const TIME_LIMIT_MARGIN_SECONDS = 10;
/** How long the app has to connect with its token. Matches claim_seconds in phone_limits(). */
export const VOICE_TOKEN_TTL_SECONDS = 120;
export const VERIFICATION_TTL_SECONDS = 600;
export const MAX_VERIFIED_NUMBERS = 2;
/** Shorter recordings hold no conversation (the called person hung up during the notice). */
export const MIN_RECORDING_SECONDS = 3;

export const BUSINESS_ANSWERS = ['business', 'personal', 'skipped'] as const;
export const BUSINESS_TYPES = [
  'home_services', 'health', 'beauty', 'food', 'real_estate', 'professional', 'retail', 'automotive', 'education', 'other',
] as const;
