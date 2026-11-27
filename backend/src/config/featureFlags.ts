/**
 * Server-side feature flags. Each is OFF unless its environment variable says otherwise, so an unset or misspelled
 * variable keeps the feature hidden. Read at request time, so a restart and tests both see changes.
 *
 *   FEATURE_PHONE_CALLS      Phone calls for everyone. To switch on: set it to 1, true, on or yes.
 *   PHONE_CALLS_TESTER_IDS   Comma separated account ids that have phone calls while the switch above is off.
 *
 * Either one also needs the calls subaccount settings (phone/settings.ts); without them nobody has the feature.
 */
const ON = new Set(['1', 'true', 'on', 'yes']);

export function isPhoneCallsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return ON.has(String(env.FEATURE_PHONE_CALLS ?? '').trim().toLowerCase());
}

export function isPhoneTester(userId: string | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!userId) return false;
  const id = userId.toLowerCase();
  return String(env.PHONE_CALLS_TESTER_IDS ?? '').split(',').some((x) => x.trim().toLowerCase() === id);
}

/** Whether this account may use phone calls at all. */
export function hasPhoneCalls(userId: string | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return isPhoneCallsEnabled(env) || isPhoneTester(userId, env);
}
