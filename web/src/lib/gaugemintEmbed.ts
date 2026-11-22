// Validator for the Gaugemint embed address shown on /admin (framed dashboard, "pattern B").
// The address is a capability: anyone holding it can read the dashboard. It comes from the server-only env var
// GAUGEMINT_EMBED_URL, is checked here, and is only ever rendered into HTML for admins. Pure, no I/O, no logging.

export const DEFAULT_GAUGEMINT_HOST = 'guagemint.com';

// Same shape Gaugemint issues for share/embed tokens: 32 random bytes, base64url (43 chars).
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
// Only the two options Gaugemint's embed page reads (?theme=light|dark, ?period=<short code>).
const PERIOD_RE = /^[A-Za-z0-9]{1,8}$/;

/** Host taken from GAUGEMINT_URL (an https origin) when set and usable, else null. */
function extraHost(gaugemintUrl?: string | null): string | null {
  const raw = (gaugemintUrl ?? '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname) return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns the normalised embed URL (rebuilt from the parsed parts, never the raw string) or null.
 * Accepts only: https, no userinfo, no port, host guagemint.com (or the host of GAUGEMINT_URL),
 * path exactly /embed/<43-char token>, optional ?theme=light|dark and ?period=<code>, no fragment.
 * Anything else, including empty input, returns null and the caller renders nothing.
 */
export function validateGaugemintEmbedUrl(raw: string | null | undefined, gaugemintUrl?: string | null): string | null {
  if (typeof raw !== 'string') return null;
  const input = raw.trim(); // tolerate the trailing newline a pasted secret often carries
  if (!input || input.length > 512) return null;

  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }

  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port) return null;
  if (u.hash || input.includes('#')) return null; // u.hash is '' for a bare trailing '#', so check the raw text too

  const allowed = new Set([DEFAULT_GAUGEMINT_HOST]);
  const extra = extraHost(gaugemintUrl);
  if (extra) allowed.add(extra);
  if (!allowed.has(u.hostname.toLowerCase())) return null;

  const m = /^\/embed\/([^/]+)$/.exec(u.pathname);
  if (!m || !TOKEN_RE.test(m[1])) return null;

  const keep = new URLSearchParams();
  const seen = new Set<string>();
  for (const [k, v] of u.searchParams) {
    if (seen.has(k)) return null;
    seen.add(k);
    if (k === 'theme' && (v === 'light' || v === 'dark')) keep.set(k, v);
    else if (k === 'period' && PERIOD_RE.test(v)) keep.set(k, v);
    else return null;
  }

  const qs = keep.toString();
  return `https://${u.hostname.toLowerCase()}/embed/${m[1]}${qs ? `?${qs}` : ''}`;
}
