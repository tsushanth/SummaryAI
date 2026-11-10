export type SessionState = 'connecting' | 'streaming' | 'reconnecting' | 'degraded' | 'closed';

export interface MetricsSnapshot {
  state: SessionState;
  audioSecondsIn: number;
  audioSecondsSent: number;
  segmentsOut: number;
  segmentsFailed: number;
  segmentsDropped: number;
  sinkRetries: number;
  reconnects: number;
  failovers: number;
  rollovers: number;
  languageChanges: number;
  gaps: number;
  gapSeconds: number;
  invalidMessages: number;
  dedupedTokens: number;
  partialsSeen: number;
  degraded: boolean;
  startedAt: number;
  lastAudioAt: number | null;
  lastSegmentAt: number | null;
}

/** Per-meeting counters. Plain numbers only: no transcript text, no names, no keys. */
export class MeetingMetrics {
  private s: MetricsSnapshot = {
    state: 'connecting', audioSecondsIn: 0, audioSecondsSent: 0, segmentsOut: 0, segmentsFailed: 0, segmentsDropped: 0,
    sinkRetries: 0, reconnects: 0, failovers: 0, rollovers: 0, languageChanges: 0, gaps: 0, gapSeconds: 0, invalidMessages: 0, dedupedTokens: 0,
    partialsSeen: 0, degraded: false, startedAt: Date.now(), lastAudioAt: null, lastSegmentAt: null,
  };

  add<K extends keyof MetricsSnapshot>(k: K, n = 1): void {
    (this.s[k] as number) += n;
  }
  set<K extends keyof MetricsSnapshot>(k: K, v: MetricsSnapshot[K]): void {
    this.s[k] = v;
  }
  snapshot(): MetricsSnapshot {
    return { ...this.s };
  }
}
