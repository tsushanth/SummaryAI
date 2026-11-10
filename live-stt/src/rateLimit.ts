export interface LimiterOptions {
  max: number;
  windowMs: number;
  /** Hard cap on tracked keys so a flood of distinct IPs cannot grow memory without bound. */
  maxKeys?: number;
  now?: () => number;
}

/** Sliding-window counter per key. `hit` records and answers "allowed?"; `count`/`isLimited` only look. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(o: LimiterOptions) {
    this.max = o.max;
    this.windowMs = o.windowMs;
    this.maxKeys = o.maxKeys ?? 10_000;
    this.now = o.now ?? Date.now;
  }

  private fresh(key: string, t: number): number[] {
    const arr = this.hits.get(key);
    if (!arr) return [];
    const cutoff = t - this.windowMs;
    let i = 0;
    while (i < arr.length && arr[i]! <= cutoff) i++;
    if (i > 0) arr.splice(0, i);
    if (arr.length === 0) this.hits.delete(key);
    return arr;
  }

  hit(key: string): boolean {
    const t = this.now();
    const arr = this.fresh(key, t);
    const allowed = arr.length < this.max;
    arr.push(t);
    if (!this.hits.has(key)) {
      if (this.hits.size >= this.maxKeys) this.evictOldest();
      this.hits.set(key, arr);
    }
    return allowed;
  }

  count(key: string): number {
    return this.fresh(key, this.now()).length;
  }

  isLimited(key: string): boolean {
    return this.count(key) >= this.max;
  }

  size(): number {
    return this.hits.size;
  }

  private evictOldest(): void {
    // Map iterates in insertion order: drop the oldest-inserted keys first.
    const drop = Math.max(1, Math.floor(this.maxKeys / 10));
    let n = 0;
    for (const k of this.hits.keys()) {
      this.hits.delete(k);
      if (++n >= drop) break;
    }
  }
}
