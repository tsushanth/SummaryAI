import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseLanguage } from './languages.js';

/**
 * Per-bot ingest token. Recall dials us, so the only credential it can carry is the URL it was given when the bot was created.
 * `ref` is an id the backend mints BEFORE calling Recall (Recall's own bot id does not exist yet at that point), so the token is
 * HMAC-SHA256(secret, ref) in lowercase hex. The backend and this service share the secret(s); rotation = list old + new here.
 */
export function mintIngestToken(secret: string, ref: string): string {
  return createHmac('sha256', secret).update(ref).digest('hex');
}

export function verifyIngestToken(secrets: string | string[], ref: string, token: string | null | undefined): boolean {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  const list = Array.isArray(secrets) ? secrets : [secrets];
  const got = Buffer.from(token, 'hex');
  let ok = false;
  for (const s of list) {
    if (!s) continue;
    const want = Buffer.from(mintIngestToken(s, ref), 'hex');
    // Evaluate every secret (no early exit) so timing does not reveal which one matched.
    if (want.length === got.length && timingSafeEqual(want, got)) ok = true;
  }
  return ok;
}

const REF_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * `/ingest/<ref>/?token=<hex>[&lang=<code>]`. Recall requires the trailing slash before `?` when the token rides in the query string.
 * `lang` is the meeting's chosen transcription language (initial Soniox language hint); an unknown value is ignored. It is not part of
 * the token: it can only bias recognition and only the holder of the URL (Recall) could change it.
 */
export function parseIngestUrl(rawUrl: string): { ref: string; token: string; lang?: string } | null {
  let u: URL;
  try {
    u = new URL(rawUrl, 'http://localhost');
  } catch {
    return null;
  }
  const m = /^\/ingest\/([^/]+)\/$/.exec(u.pathname);
  if (!m || !m[1] || !REF_RE.test(m[1])) return null;
  const lang = parseLanguage(u.searchParams.get('lang'));
  return { ref: m[1], token: u.searchParams.get('token') ?? '', ...(lang ? { lang } : {}) };
}
