export type AlertKind = 'soniox_concurrency_429' | 'mm_stream_cap' | 'soniox_fatal' | 'live_degraded' | 'stt_failover' | 'sink_failing';
export type AlertHook = (kind: AlertKind, ctx: Record<string, string | number | boolean | null>) => void;

export interface WebhookAlertOptions {
  url: string;
  /** At most one alert per kind per interval. */
  minIntervalMs?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
  service?: string;
}

/** Throttled JSON POST (Slack-compatible `text` plus structured fields). ctx must hold ids and counts only: no transcript text, no keys. */
export function makeWebhookAlert(o: WebhookAlertOptions): AlertHook {
  const last = new Map<string, number>();
  const now = o.now ?? Date.now;
  return (kind, ctx) => {
    const t = now();
    const prev = last.get(kind);
    if (prev !== undefined && t - prev < (o.minIntervalMs ?? 5 * 60_000)) return;
    last.set(kind, t);
    const body = JSON.stringify({ text: `[${o.service ?? 'mm-live-stt'}] ${kind}`, kind, ...ctx });
    void (o.fetchFn ?? fetch)(o.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => { /* alerts are best effort */ });
  };
}

export const consoleAlert: AlertHook = (kind, ctx) => {
  console.warn(JSON.stringify({ level: 'warn', alert: kind, ...ctx }));
};
