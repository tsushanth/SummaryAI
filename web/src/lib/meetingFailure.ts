/**
 * Why a meeting failed, in words for the user. Pure (node loads it in scripts/meetingFailure.test.mjs).
 *
 * When the monthly meeting-bot allowance is used up, the backend closes the scheduled meeting as failed and stores
 * error_message (error code BOT_MONTHLY_CAP_REACHED, "...The bot is available again on YYYY-MM-DD (UTC)..."). That case is
 * shown as one friendly sentence with the reset date in the user's locale; any other failed meeting gets a generic sentence
 * (the stored text can contain raw provider errors and is not shown).
 */

export const BOT_MONTHLY_CAP_REACHED = 'BOT_MONTHLY_CAP_REACHED';

export const GENERIC_FAILURE = 'The meeting bot could not join this meeting.';

const CAP_TEXT = /meeting-bot minutes for this month/i;
const RESET_DATE = /available again on (\d{4}-\d{2}-\d{2})/i;

/** 'YYYY-MM-DD' or an ISO timestamp. The allowance resets at the start of a UTC month, so the date is shown in UTC. */
export function formatResetDate(resetsAt: string | null | undefined, locale?: string): string | null {
  if (!resetsAt) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(resetsAt) ? `${resetsAt}T00:00:00Z` : resetsAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function botCapMessage(resetsAt?: string | null, locale?: string): string {
  const date = formatResetDate(resetsAt, locale);
  return `You have used this month's meeting bot time. It resets ${date ? `on ${date}` : 'at the start of next month'}. You can still record meetings yourself.`;
}

export function isBotCapMessage(message: string | null | undefined): boolean {
  return !!message && (message.includes(BOT_MONTHLY_CAP_REACHED) || CAP_TEXT.test(message));
}

/** The text to show for a failed meeting, or null when it did not fail or no reason was recorded. */
export function meetingFailureReason(
  meeting: { status: string; error_message?: string | null },
  locale?: string
): string | null {
  if (meeting.status !== 'failed') return null;
  const message = meeting.error_message?.trim();
  if (!message) return null;
  if (isBotCapMessage(message)) return botCapMessage(message.match(RESET_DATE)?.[1], locale);
  // Other messages can hold raw text from the meeting provider or our own errors, so they are never shown as stored.
  return GENERIC_FAILURE;
}
