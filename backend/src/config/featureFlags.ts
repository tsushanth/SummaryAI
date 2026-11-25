/**
 * Server-side feature flags. Each is OFF unless its environment variable says otherwise, so an unset or misspelled
 * variable keeps the feature hidden. Read at request time, so a restart and tests both see changes.
 *
 *   FEATURE_PHONE_CALLS   /api/phone and the two Twilio webhooks that make Twilio dial a number.
 *                         To switch on: set it to 1, true, on or yes (and turn the web and Android flags on too).
 */
const ON = new Set(['1', 'true', 'on', 'yes']);

export function isPhoneCallsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return ON.has(String(env.FEATURE_PHONE_CALLS ?? '').trim().toLowerCase());
}
