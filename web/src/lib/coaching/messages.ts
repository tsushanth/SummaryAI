/**
 * What the AI Coach says. The wording is Android's (res/values/strings_coach.xml); only the join hints name web pages.
 * No runtime imports.
 */
import type { CoachingState } from './session.ts';

export const COACH_PERSONA = { key: 'sales_discovery', label: 'Sales Discovery' } as const;

export const COACH_TEXT = {
  title: 'AI Coach',
  stop: 'Stop',
  retry: 'Retry',
  listening: 'Listening for tactical moments…',
  listeningHint: 'Tips appear about every 30 seconds once the bot is in the meeting and people are talking.',
  joinHint: 'Tips appear on the meeting page. Admit the bot when it asks to join.',
  joinNowOnly: 'AI Coach starts with Join now only, not for a meeting added for later.',
  delayedLanguage: 'In this language the live transcript arrives minutes late, so tips will be late too.',
  checkingSessions: 'Checking your sessions…',
  sessionsUnknown: 'Could not check your sessions.',
  notStartedForAdded: 'Meeting added. AI Coach was not started: it works with Join now only.',
  noRecording: 'The bot is on its way, but AI Coach could not start for this meeting.',
} as const;

export function sessionsLeftText(balance: number): string {
  if (balance <= 0) return 'No sessions left';
  return balance === 1 ? '1 session left' : `${balance} sessions left`;
}

/** Why the coach is not (or no longer) giving tips, in the user's words. Null while it is live. */
export function coachingStatusText(state: CoachingState): string | null {
  switch (state.phase) {
    case 'live':
      return null;
    case 'starting':
      return 'Starting AI Coach…';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'not_started':
      if (state.startFailure === 'no_credits') return 'AI Coach did not start because you have no sessions left.';
      if (state.startFailure === 'meeting_over') return 'AI Coach did not start because the bot is no longer in the meeting.';
      return 'AI Coach could not start. Check your connection and try again.';
    case 'ended':
      switch (state.endReason) {
        case 'bot_not_admitted':
          return 'AI Coach stopped because the bot was not let into the meeting.';
        case 'bot_failed':
          return 'AI Coach stopped because the bot could not join the meeting.';
        case 'no_speech':
          return 'AI Coach ended without hearing any speech.';
        case 'model_failed':
          return 'AI Coach could not create tips because of a problem on our side.';
        default:
          return 'AI Coach has ended.';
      }
  }
}

/** What happened to the session credit, when that is worth saying. */
export function coachingCreditText(state: CoachingState): string | null {
  if (state.phase === 'ended' && state.refunded) return 'Your session credit was returned.';
  if (state.phase === 'not_started' && state.startFailure === 'meeting_over') return 'No credit was used.';
  return null;
}

/** A tip's place in the meeting, e.g. 4:07. */
export function tipOffsetText(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number') return null;
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
