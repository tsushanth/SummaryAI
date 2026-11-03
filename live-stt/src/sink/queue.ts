import type { MeetingMetrics } from '../metrics.js';
import { SinkError, type LiveSegment, type SegmentSink } from './types.js';

export interface DeliveryQueueOptions {
  metrics: MeetingMetrics;
  maxQueue?: number;
  maxBatch?: number;
  backoffMs?: number[];
  /** Give up on a batch after this many retryable failures in a row (counted as failed). */
  maxAttempts?: number;
}

/**
 * Per-meeting, in-order, bounded delivery. One batch in flight at a time so rows reach the backend (and clients polling by
 * created_at) in segment order. Retryable errors back off and retry; permanent ones drop the batch. When the sink is down
 * the queue holds at most maxQueue segments: the OLDEST are dropped (and counted), never memory growth.
 */
export class DeliveryQueue {
  private q: LiveSegment[] = [];
  private running = false;
  private idleWaiters: (() => void)[] = [];
  private readonly maxQueue: number;
  private readonly maxBatch: number;
  private readonly backoff: number[];
  private readonly maxAttempts: number;
  private stopped = false;

  constructor(private readonly sink: SegmentSink, private readonly o: DeliveryQueueOptions) {
    this.maxQueue = o.maxQueue ?? 500;
    this.maxBatch = o.maxBatch ?? 20;
    this.backoff = o.backoffMs ?? [250, 500, 1000, 2000, 5000];
    this.maxAttempts = o.maxAttempts ?? 30;
  }

  length(): number {
    return this.q.length;
  }

  enqueue(s: LiveSegment): void {
    this.q.push(s);
    if (this.q.length > this.maxQueue) {
      const drop = this.q.length - this.maxQueue;
      this.q.splice(0, drop);
      this.o.metrics.add('segmentsDropped', drop);
    }
    void this.pump();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.q.length > 0 && !this.stopped) {
        const batch = this.q.slice(0, this.maxBatch);
        let attempt = 0;
        for (;;) {
          try {
            await this.sink.write(batch);
            this.o.metrics.add('segmentsOut', batch.length);
            this.o.metrics.set('lastSegmentAt', Date.now());
            break;
          } catch (e) {
            const retryable = e instanceof SinkError ? e.retryable : true;
            if (!retryable || ++attempt >= this.maxAttempts || this.stopped) {
              this.o.metrics.add('segmentsFailed', batch.length);
              break;
            }
            this.o.metrics.add('sinkRetries');
            await this.sleep(this.backoff[Math.min(attempt - 1, this.backoff.length - 1)]!);
          }
        }
        // Remove what we just handled; enqueue() may have trimmed the head meanwhile, so remove by identity.
        const done = new Set(batch);
        this.q = this.q.filter((x) => !done.has(x));
      }
    } finally {
      this.running = false;
      if (this.q.length === 0) {
        const w = this.idleWaiters.splice(0);
        for (const f of w) f();
      }
    }
  }

  /** Resolves when everything queued so far is delivered or dropped, or after timeoutMs (never rejects). */
  drain(timeoutMs: number): Promise<void> {
    if (this.q.length === 0 && !this.running) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.stopped = true; resolve(); }, timeoutMs);
      this.idleWaiters.push(() => { clearTimeout(t); resolve(); });
      void this.pump();
    });
  }

  stop(): void {
    this.stopped = true;
  }
}
