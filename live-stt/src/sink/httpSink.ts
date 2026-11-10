import { createHmac, timingSafeEqual } from 'node:crypto';
import { SinkError, type LiveSegment, type SegmentSink } from './types.js';

/** `v1=` + hex HMAC-SHA256(secret, `${timestampSec}.${rawBody}`). The backend verifies the same way (copy verifySignature). */
export function signBody(secret: string, timestampSec: string, body: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestampSec}.${body}`).digest('hex');
}

export function verifySignature(secret: string, timestampSec: string, body: string, signature: string, o: { nowSec?: number; toleranceSec?: number } = {}): boolean {
  const now = o.nowSec ?? Math.floor(Date.now() / 1000);
  const ts = Number(timestampSec);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (o.toleranceSec ?? 300)) return false;
  const want = Buffer.from(signBody(secret, timestampSec, body));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface HttpSinkOptions {
  /** e.g. https://summary-ai-backend.fly.dev/internal/live-segments (Fly private network URL works too). */
  url: string;
  secret: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  nowSec?: () => number;
}

/** Default sink: signed POST to a new internal backend route, which owns the insert and the live-insight trigger. */
export class HttpSink implements SegmentSink {
  readonly name = 'http';
  constructor(private readonly o: HttpSinkOptions) {}

  async write(batch: LiveSegment[]): Promise<void> {
    if (batch.length === 0) return;
    const first = batch[0]!;
    const body = JSON.stringify({
      v: 1,
      botId: first.botId,
      ref: first.ref,
      sessionId: first.sessionId,
      segments: batch.map((s) => ({
        key: s.key, seq: s.seq, segment_text: s.segment_text, speaker_id: s.speaker_id, speaker_name: s.speaker_name, is_host: s.is_host,
        start_timestamp: s.start_timestamp, end_timestamp: s.end_timestamp, words: s.words, is_partial: false, language: s.language,
      })),
    });
    const ts = String(this.o.nowSec ? this.o.nowSec() : Math.floor(Date.now() / 1000));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 8000);
    let res: Response;
    try {
      res = await (this.o.fetchFn ?? fetch)(this.o.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mm-timestamp': ts, 'x-mm-signature': signBody(this.o.secret, ts, body) },
        body,
        signal: ctl.signal,
      });
    } catch (e) {
      throw new SinkError(`http sink network error: ${(e as Error).name}`, true);
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return;
    const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
    throw new SinkError(`http sink status ${res.status}`, retryable, res.status);
  }
}
