/**
 * The `.or(...)` filter behind GET /api/meetings?status=upcoming.
 *
 * By default: meetings starting within the window, or already started and not yet at their end. A meeting added by link has no
 * end, so it drops out the moment it starts, including while the bot is in it and after it failed. With `includeRecent` (the
 * web app asks for it; other clients are unchanged) those stay: bot activity started in the last day, failures in the last week.
 */
export const RECENT_ACTIVE_MS = 24 * 60 * 60 * 1000;
export const RECENT_FAILED_MS = 7 * 24 * 60 * 60 * 1000;
export const ACTIVE_MEETING_STATUSES = ['bot_queued', 'bot_joining', 'bot_in_meeting', 'bot_left'] as const;

export function upcomingMeetingsFilter(nowMs: number, daysAhead: number, includeRecent: boolean): string {
  const iso = (ms: number) => new Date(ms).toISOString();
  const now = iso(nowMs);
  const until = iso(nowMs + daysAhead * 24 * 60 * 60 * 1000);
  const parts = [
    `and(scheduled_start.gte.${now},scheduled_start.lte.${until})`,
    `and(scheduled_start.lt.${now},scheduled_end.gt.${now})`,
  ];
  if (includeRecent) {
    parts.push(
      `and(status.in.(${ACTIVE_MEETING_STATUSES.join(',')}),scheduled_start.lt.${now},scheduled_start.gte.${iso(nowMs - RECENT_ACTIVE_MS)})`,
      `and(status.eq.failed,scheduled_start.lt.${now},scheduled_start.gte.${iso(nowMs - RECENT_FAILED_MS)})`
    );
  }
  return parts.join(',');
}
