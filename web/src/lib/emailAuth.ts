/** Pure helpers for email/password auth on the web. No runtime imports (unit-tested in node). */

export function isValidEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** For choosing a NEW password (sign-up, reset). Sign-in never calls this: existing accounts may have shorter ones. */
export function passwordProblem(password: string): string | null {
  if (!password) return 'Enter a password.';
  if (password.length < 8) return 'Use at least 8 characters.';
  return null;
}

/** Same-site relative path only; anything else falls back (prevents open redirects through ?next=). */
export function safeNextPath(next: string | null | undefined, fallback = '/recordings'): string {
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')) return next;
  return fallback;
}

/** Where the password-reset email link sends the user: the OAuth/PKCE callback, then the new-password page. */
export function resetRedirectUrl(origin: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent('/auth/reset')}`;
}

export function friendlyAuthError(message: string | null | undefined): string {
  if (!message) return 'Something went wrong. Please try again.';
  if (/invalid login credentials/i.test(message)) return 'That email or password is not right.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first: check your inbox for the link we sent.';
  if (/already registered|already been registered/i.test(message)) return 'An account with this email already exists. Sign in instead.';
  return message;
}
