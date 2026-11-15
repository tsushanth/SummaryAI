/**
 * Speech provider for languages other than English (REST, MP3). Used only when MEETING_ASSISTANT_MULTILINGUAL is on and the answer
 * language is not English; English keeps its own provider in tts.ts.
 *
 *   POST {READALOUD_API_URL or https://api.readaloudai.org}/v1/text-to-speech/{voice}?output_format=mp3_44100_128
 *   Authorization: Bearer $READALOUD_API_KEY      body {"text": "...", "language_code": "ru"[, "normalize": "numbers"]}
 *
 * The route is not streaming (about a quarter of real time, 0.7 to 1.5 s for a short line), so an answer is cut into pieces of at most
 * CHUNK_CHARS characters at sentence or clause edges, rendered with at most MAX_CONCURRENT requests in flight for the whole process,
 * and joined into one MP3 for Recall. 502/503 are retried once. 402 means the account has no credits: the provider then stops calling
 * for CREDIT_BLOCK_MS (the assistant stays silent in that language and logs one typed event) instead of failing every question slowly.
 * A missing key is the same kind of silent failure. Nothing here logs text.
 */
export type TtsErrorKind = 'no_credits' | 'no_key' | 'upstream' | 'timeout' | 'bad_audio' | 'unsupported';

export class TtsError extends Error {
  constructor(readonly kind: TtsErrorKind, readonly status?: number) {
    super(`speech provider: ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'TtsError';
  }
}

export const CHUNK_CHARS = 170;
export const MAX_CONCURRENT = 2;
export const CREDIT_BLOCK_MS = 10 * 60_000;
const DEFAULT_BASE = 'https://api.readaloudai.org';
const REQUEST_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 250;

/** Process-wide counters (no text). Read with getReadAloudStats(). */
const stats = { requests: 0, chars: 0, retries: 0, noCredits: 0, noKey: 0, upstreamErrors: 0, timeouts: 0, blockedSkips: 0 };
export const getReadAloudStats = (): Readonly<typeof stats> => ({ ...stats });
export function resetReadAloudStats(): void { for (const k of Object.keys(stats) as Array<keyof typeof stats>) stats[k] = 0; }

/** Split at sentence ends, then at commas / semicolons, then at spaces; no piece longer than `max` (unless one word is). */
export function splitForSpeech(text: string, max = CHUNK_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const out: string[] = [];
  const pushPiece = (piece: string): void => {
    let rest = piece.trim();
    while (rest.length > max) {
      const win = rest.slice(0, max + 1);
      let cut = Math.max(win.lastIndexOf(', '), win.lastIndexOf('; '), win.lastIndexOf(': '), win.lastIndexOf(' - '));
      if (cut < max * 0.4) cut = win.lastIndexOf(' ');
      if (cut <= 0) cut = max; // one very long word
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
  };
  // Greedy: pack whole sentences into a piece while they fit.
  const sentences = clean.match(/[^.!?…]+[.!?…]*["')\]]*\s*/gu) ?? [clean];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).trim().length <= max) { cur += s; continue; }
    if (cur.trim()) { out.push(cur.trim()); cur = ''; }
    if (s.trim().length <= max) cur = s; else pushPiece(s);
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Strip an ID3v2 header from the front and an ID3v1 tag from the end, so pieces can be joined frame to frame. */
export function bareMp3(buf: Buffer): Buffer {
  let start = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    start = 10 + (((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f));
  }
  let end = buf.length;
  if (end - start > 128 && buf.toString('latin1', end - 128, end - 125) === 'TAG') end -= 128;
  return buf.subarray(Math.min(start, end), end);
}

class Semaphore {
  private waiters: Array<() => void> = [];
  private free: number;
  constructor(n: number) { this.free = n; }
  async acquire(): Promise<void> {
    if (this.free > 0) { this.free--; return; }
    await new Promise<void>((r) => this.waiters.push(r));
  }
  release(): void {
    const w = this.waiters.shift();
    if (w) w(); else this.free++;
  }
}

export interface ReadAloudDeps {
  fetchFn?: typeof fetch;
  getKey?: () => string | undefined;
  getBaseUrl?: () => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Limiter shared by every call that uses these deps. Default: the process-wide one. */
  semaphore?: { acquire(): Promise<void>; release(): void };
}

const globalSemaphore = new Semaphore(MAX_CONCURRENT);
let blockedUntil = 0;
export function resetReadAloudBreaker(): void { blockedUntil = 0; }

/** Is the provider worth calling right now (no recent 402, key present)? Cheap, no network. */
export function readAloudAvailable(deps: Pick<ReadAloudDeps, 'getKey' | 'now'> = {}): boolean {
  const now = (deps.now ?? Date.now)();
  const key = (deps.getKey ?? (() => process.env.READALOUD_API_KEY))();
  return !!key && now >= blockedUntil;
}

export interface SynthRequest {
  text: string;
  voice: string;
  language: string;
  /** 'numbers' asks the provider to read digits for languages that have rules for it; 'none' (or omitted) sends nothing. */
  normalize?: 'numbers' | 'none';
}

async function renderPiece(req: SynthRequest, piece: string, d: Required<Omit<ReadAloudDeps, 'semaphore'>> & { semaphore: NonNullable<ReadAloudDeps['semaphore']> }): Promise<Buffer> {
  const key = d.getKey();
  if (!key) { stats.noKey++; throw new TtsError('no_key'); }
  const base = d.getBaseUrl().replace(/\/+$/, '');
  const url = `${base}/v1/text-to-speech/${encodeURIComponent(req.voice)}?output_format=mp3_44100_128`;
  const body = JSON.stringify({ text: piece, language_code: req.language, ...(req.normalize === 'numbers' ? { normalize: 'numbers' } : {}) });
  for (let attempt = 0; attempt < 2; attempt++) {
    await d.semaphore.acquire();
    let res: Response;
    try {
      stats.requests++;
      stats.chars += piece.length;
      res = await d.fetchFn(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      d.semaphore.release();
      const timedOut = /abort|timeout/i.test(String((err as Error)?.name) + String((err as Error)?.message));
      if (timedOut) stats.timeouts++; else stats.upstreamErrors++;
      throw new TtsError(timedOut ? 'timeout' : 'upstream');
    }
    let bytes: Buffer | null = null;
    try {
      if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
    } catch { /* treated as upstream error below */ } finally { d.semaphore.release(); }
    if (res.status === 402) {
      stats.noCredits++;
      blockedUntil = d.now() + CREDIT_BLOCK_MS;
      throw new TtsError('no_credits', 402);
    }
    if ((res.status === 502 || res.status === 503) && attempt === 0) {
      stats.retries++;
      await d.sleep(RETRY_DELAY_MS);
      continue;
    }
    if (!res.ok || !bytes) { stats.upstreamErrors++; throw new TtsError('upstream', res.status); }
    if (bytes.length < 200) throw new TtsError('bad_audio', res.status);
    return bytes;
  }
  stats.upstreamErrors++;
  throw new TtsError('upstream');
}

/** Render a whole answer to one MP3. Throws TtsError. Pieces are rendered concurrently (bounded) and joined in order. */
export async function synthesizeReadAloud(req: SynthRequest, deps: ReadAloudDeps = {}): Promise<{ audio: Buffer; chars: number; pieces: number }> {
  const d = {
    fetchFn: deps.fetchFn ?? fetch,
    getKey: deps.getKey ?? (() => process.env.READALOUD_API_KEY?.trim() || undefined),
    getBaseUrl: deps.getBaseUrl ?? (() => process.env.READALOUD_API_URL?.trim() || DEFAULT_BASE),
    sleep: deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    now: deps.now ?? Date.now,
    semaphore: deps.semaphore ?? globalSemaphore,
  };
  if (!d.getKey()) { stats.noKey++; throw new TtsError('no_key'); }
  if (d.now() < blockedUntil) { stats.blockedSkips++; throw new TtsError('no_credits'); }
  const pieces = splitForSpeech(req.text);
  if (pieces.length === 0) throw new TtsError('bad_audio');
  const parts = await Promise.all(pieces.map((p) => renderPiece(req, p, d)));
  const audio = parts.length === 1 ? parts[0]! : Buffer.concat([parts[0]!, ...parts.slice(1).map(bareMp3)]);
  return { audio, chars: pieces.reduce((n, p) => n + p.length, 0), pieces: pieces.length };
}
