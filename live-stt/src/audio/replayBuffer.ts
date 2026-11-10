export interface AudioChunk {
  /** Recall `timestamp.relative` of the chunk start, in ms since the recording started. */
  relMs: number;
  durMs: number;
  pcm: Buffer;
}

export interface ReplayBufferOptions {
  /** Keep this much already-sent audio so a reconnect can replay it (spec: 10 s). */
  retainMs: number;
  /** Absolute cap, including audio that could not be sent (Soniox down). Beyond it the oldest audio is lost and counted. */
  hardCapMs: number;
}

/**
 * Rolling audio buffer. Sent audio is kept for `retainMs` for replay after a reconnect; unsent audio (stream down or still
 * connecting) is kept up to `hardCapMs`. Memory per meeting is therefore bounded by hardCapMs * 32 bytes/ms (1.9 MB at 60 s).
 */
export class ReplayBuffer {
  private chunks: AudioChunk[] = [];
  private totalBytes = 0;
  private totalMs = 0;
  private lost = 0;
  private sentUpToEndMs = -1;

  constructor(private readonly o: ReplayBufferOptions) {}

  push(c: AudioChunk): void {
    this.chunks.push(c);
    this.totalBytes += c.pcm.length;
    this.totalMs += c.durMs;
    this.trim();
  }

  /** Everything ending at or before `endMs` has been written to the current stream. */
  markSent(endMs: number): void {
    if (endMs > this.sentUpToEndMs) this.sentUpToEndMs = endMs;
    this.trim();
  }

  /** A new stream starts from scratch: nothing is sent on it yet. */
  resetSent(): void {
    this.sentUpToEndMs = -1;
  }

  private drop(): AudioChunk {
    const c = this.chunks.shift()!;
    this.totalBytes -= c.pcm.length;
    this.totalMs -= c.durMs;
    return c;
  }

  private trim(): void {
    const newest = this.newestEndMs();
    if (newest === null) return;
    while (this.chunks.length > 0) {
      const head = this.chunks[0]!;
      const headEnd = head.relMs + head.durMs;
      const sent = headEnd <= this.sentUpToEndMs;
      const aged = headEnd < newest - this.o.retainMs;
      const overCap = this.totalMs > this.o.hardCapMs;
      if (overCap) {
        const c = this.drop();
        if (c.relMs + c.durMs > this.sentUpToEndMs) this.lost += c.durMs;
      } else if (sent && aged) {
        this.drop();
      } else break;
    }
  }

  chunksFrom(relMs: number): AudioChunk[] {
    return this.chunks.filter((c) => c.relMs + c.durMs > relMs);
  }

  earliestMs(): number | null {
    return this.chunks.length ? this.chunks[0]!.relMs : null;
  }

  newestEndMs(): number | null {
    const c = this.chunks[this.chunks.length - 1];
    return c ? c.relMs + c.durMs : null;
  }

  durationMs(): number {
    return this.totalMs;
  }

  bytes(): number {
    return this.totalBytes;
  }

  /** Unsent audio dropped because the cap was hit. */
  lostMs(): number {
    return this.lost;
  }
}
