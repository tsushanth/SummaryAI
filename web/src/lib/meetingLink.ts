/** Helpers for the "add a meeting by link" form. Pure (node loads it in scripts/meetingLink.test.mjs). */

export const ZOOM_BROWSER_LINK_WARNING =
  'This is the link from the Zoom web page, and the bot often cannot join with it. In Zoom, choose "Copy invite link" and paste that instead.';
export const ZOOM_NO_PASSCODE_WARNING =
  'This Zoom link has no passcode (pwd=). If the meeting has one, the bot cannot join. In Zoom, choose "Copy invite link" and paste the whole link.';

const ZOOM_HOSTS = ['zoom.us', 'zoom.com', 'zoomgov.com'];

/** A warning for a Zoom link the bot is likely to be refused with, else null. Advice only: the form still submits. */
export function zoomLinkWarning(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!ZOOM_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  if (parsed.pathname.startsWith('/wc/')) return ZOOM_BROWSER_LINK_WARNING;
  return parsed.searchParams.get('pwd') ? null : ZOOM_NO_PASSCODE_WARNING;
}

/** The next quarter hour, as local date and time input values (toISOString() is UTC and gave tomorrow's date in the evening). */
export function getDefaultDateTime(now: Date = new Date()): { date: string; time: string } {
  const next = new Date(now);
  next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`,
    time: `${pad(next.getHours())}:${pad(next.getMinutes())}`,
  };
}
