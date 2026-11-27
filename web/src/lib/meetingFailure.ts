/**
 * Why a meeting failed, in words for the user. Pure (node loads it in scripts/meetingFailure.test.mjs).
 *
 * When the bot fails or is never let in, the backend stores Recall's sub_code (meetings.error_message, recordings.error_code,
 * see backend/src/routes/webhooks.ts and services/botFailure.ts). Known codes are turned into a plain sentence here.
 *
 * When the monthly meeting-bot allowance is used up, the backend closes the scheduled meeting as failed and stores
 * error_message (error code BOT_MONTHLY_CAP_REACHED, "...The bot is available again on YYYY-MM-DD (UTC)..."). That case is
 * shown as one friendly sentence with the reset date in the user's locale; anything unrecognised gets a generic sentence
 * (the stored text can contain raw provider errors and is not shown).
 */

export const BOT_MONTHLY_CAP_REACHED = 'BOT_MONTHLY_CAP_REACHED';

export const GENERIC_FAILURE = 'The meeting bot could not join this meeting.';

const PASSCODE =
  'The meeting passcode was wrong or missing. In Zoom, choose "Copy invite link" and paste the whole link, including the part after pwd=.';
const NOT_FOUND = 'The meeting was not found. Check that the link is correct and has not expired.';
const NOT_ADMITTED =
  'The bot was not let in from the waiting room in time. Admit "Meeting Mind" when it asks to join.';
const SIGN_IN = 'This meeting only lets signed-in or registered people join, so the bot could not get in.';
const NO_PERMISSION = 'The host did not allow the bot to record.';
const BLOCKED = 'The meeting blocked the bot from joining.';

/** Recall sub_codes (https://docs.recall.ai/docs/sub-codes) plus the backend's own fallback codes. */
const BOT_FAILURES: Record<string, string> = {
  meeting_password_incorrect: PASSCODE,
  webex_password_required: 'The meeting needs a password. Paste a link that includes it.',
  meeting_not_found: NOT_FOUND,
  meeting_link_invalid: NOT_FOUND,
  meeting_link_expired: NOT_FOUND,
  timeout_exceeded_waiting_room: NOT_ADMITTED,
  call_ended_by_platform_waiting_room_timeout: NOT_ADMITTED,
  bot_kicked_from_waiting_room: 'The host removed the bot from the waiting room.',
  meeting_not_started: 'The meeting had not started when the bot tried to join.',
  meeting_ended: 'The meeting had already ended.',
  call_ended_by_host: 'The meeting ended before the bot could record it.',
  meeting_locked: 'The meeting was locked.',
  meeting_full: 'The meeting was full.',
  meeting_requires_sign_in: SIGN_IN,
  meeting_requires_registration: SIGN_IN,
  zoom_registration_required: SIGN_IN,
  zoom_sso_login_required: SIGN_IN,
  zoom_email_required: SIGN_IN,
  zoom_anonymous_join_not_allowed: SIGN_IN,
  zoom_authorized_participants_only: SIGN_IN,
  google_meet_organisation_restricted: SIGN_IN,
  zoom_bot_blocked: BLOCKED,
  google_meet_bot_blocked: BLOCKED,
  google_meet_knocking_disabled: BLOCKED,
  zoom_email_blocked_by_admin: BLOCKED,
  recording_permission_denied: NO_PERMISSION,
  zoom_local_recording_disabled: NO_PERMISSION,
  zoom_local_recording_request_disabled: NO_PERMISSION,
  zoom_local_recording_request_disabled_by_host: NO_PERMISSION,
  zoom_local_recording_request_denied_by_host: NO_PERMISSION,
  zoom_local_recording_denied: NO_PERMISSION,
  bot_never_recorded: 'The bot left without recording anything.',
  bot_fatal: 'The meeting bot could not join this meeting.',
  // Stored by the backend before it kept the sub_code.
  'Bot encountered a fatal error': 'The meeting bot could not join this meeting.',
};

/** The sentence for a stored bot failure code, or null when the value is not one we know. */
export function botFailureSentence(code: string | null | undefined): string | null {
  const key = code?.trim();
  return key && Object.prototype.hasOwnProperty.call(BOT_FAILURES, key) ? BOT_FAILURES[key] : null;
}

/** Why the bot recording failed, or null for any other recording (upload or processing failures have their own copy). */
export function recordingBotFailureReason(recording: {
  status: string;
  error_code?: string | null;
  error_message?: string | null;
}): string | null {
  if (recording.status !== 'failed') return null;
  const known = botFailureSentence(recording.error_code) ?? botFailureSentence(recording.error_message);
  if (known) return known;
  // Recall's codes are lower_snake_case; the backend's own upload and processing codes are UPPER_CASE.
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(recording.error_code ?? '') ? GENERIC_FAILURE : null;
}

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

export const BOT_ON_ITS_WAY = 'Bot is joining the meeting...';
export const BOT_WAITING =
  'The bot is waiting to be let in. In your meeting, admit "Meeting Mind" (or the bot name you chose). It gives up after 10 minutes.';

/** What to say while the bot is not in the meeting yet. Older servers send no bot_state. */
export function botJoiningText(meeting: { bot_state?: { state: string } | null }): string {
  return meeting.bot_state?.state === 'waiting_room' ? BOT_WAITING : BOT_ON_ITS_WAY;
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
  return botFailureSentence(message) ?? GENERIC_FAILURE;
}
