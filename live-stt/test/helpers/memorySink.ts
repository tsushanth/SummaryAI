import type { LiveSegment, SegmentSink } from '../../src/sink/types.js';

export class MemorySink implements SegmentSink {
  readonly name = 'memory';
  segments: LiveSegment[] = [];
  batches = 0;
  /** Reject the next N writes with this retryability. */
  failNext = 0;
  failRetryable = true;
  async write(batch: LiveSegment[]): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      const { SinkError } = await import('../../src/sink/types.js');
      throw new SinkError('boom', this.failRetryable);
    }
    this.batches++;
    this.segments.push(...batch);
  }
}
