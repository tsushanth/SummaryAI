/**
 * What the user is told when a calendar sign-in fails. The code goes on the app's deep link
 * (summaryai://calendar/error?message=<code>), where the app picks its own translated message; the web page shows the
 * English text here. Nothing from the query string is ever shown.
 */

/** Microsoft's codes for "only an administrator can approve this app in your organisation". */
const ADMIN_APPROVAL = /AADSTS(90094|90095|65001)\b/;

/** The code for a refusal the provider sent back. */
export function providerRefusalCode(error: unknown, description?: unknown): string {
  const e = String(Array.isArray(error) ? error[0] : error);
  if (e === 'consent_required' || (typeof description === 'string' && ADMIN_APPROVAL.test(description))) return 'admin_consent_required';
  return e;
}

const GENERAL = 'Something went wrong while connecting your calendar. Please try again in a few minutes.';
const EXPIRED = 'This sign-in took too long or was already used. Go back to Meeting Mind and connect again.';

const MESSAGES: Record<string, string> = {
  access_denied: 'Access to your calendar was not given, so nothing was connected.',
  admin_consent_required: 'Your work or school account needs an administrator to approve Meeting Mind. Ask your IT team, or connect a personal account.',
  invalid_state: EXPIRED,
  state_expired: EXPIRED,
};

export function calendarErrorText(code: string): string {
  return Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code]! : GENERAL;
}
