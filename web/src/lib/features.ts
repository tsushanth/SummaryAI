/**
 * Web feature switches. Plain constants (no imports) so the node tests and the middleware can both load this file.
 *
 * Phone calls are switched off. To switch them back on: set PHONE_CALLS_ENABLED to true, restore the landing page and
 * llms.txt wording, set FEATURE_PHONE_CALLS on the backend and the Android PHONE_CALLS flag.
 */
export const PHONE_CALLS_ENABLED: boolean = false;

/** True for a page that must not be reachable while its feature is off: /phone and everything under it. */
export function isSwitchedOffPath(pathname: string, phoneCalls: boolean = PHONE_CALLS_ENABLED): boolean {
  return !phoneCalls && (pathname === '/phone' || pathname.startsWith('/phone/'));
}
