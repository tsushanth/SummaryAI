// Starting a calendar sign-in from the website. No imports, so scripts/calendarConnect.test.mjs can run it directly.

export class PopupBlockedError extends Error {
  constructor() {
    super('The calendar sign-in window was blocked');
    this.name = 'PopupBlockedError';
  }
}

type SignInWindow = { location: { href: string }; close: () => void };

/**
 * Opens the sign-in window first and only then asks the server where to send it: a window opened after waiting for the
 * server counts as a pop-up and is blocked (always in Safari), which looked like the button doing nothing.
 */
export async function openCalendarSignIn<W extends SignInWindow>(open: () => W | null, authUrl: () => Promise<string>): Promise<W> {
  const popup = open();
  if (!popup) throw new PopupBlockedError();
  try {
    popup.location.href = await authUrl();
  } catch (error) {
    popup.close();
    throw error;
  }
  return popup;
}

/** What the person is told when the sign-in could not be started. */
export function calendarConnectMessage(error: unknown): string {
  const e = error as { name?: string; status?: number; message?: string } | null;
  if (e?.name === 'PopupBlockedError') return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  // A handled refusal from our server carries its own sentence.
  if (e?.name === 'ApiError' && typeof e.status === 'number' && e.status < 500 && e.message) return e.message;
  return 'Could not start the calendar sign-in. Please try again in a moment.';
}
