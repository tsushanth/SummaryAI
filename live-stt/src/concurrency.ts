/**
 * Global cap on simultaneous Soniox streams opened by THIS service. The Soniox account is shared with other products
 * (default org limit: 10 concurrent realtime streams), so MeetingMind must never be able to starve dictation. Default cap 3.
 * A rollover briefly holds 2 streams for one meeting, so the cap counts streams, not meetings.
 */
export class StreamLimiter {
  private used = 0;
  constructor(private readonly cap: number) {}
  acquire(): boolean {
    if (this.used >= this.cap) return false;
    this.used++;
    return true;
  }
  release(): void {
    if (this.used > 0) this.used--;
  }
  available(): number {
    return Math.max(0, this.cap - this.used);
  }
  inUse(): number {
    return this.used;
  }
  capacity(): number {
    return this.cap;
  }
}
