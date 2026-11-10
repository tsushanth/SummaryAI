/**
 * In-process counters and a small latency summary for the live transcription path, plus structured log events.
 * No transcript text, speaker names, secrets or user ids ever go in here: labels are provider/reason/language codes only, and a
 * meeting is identified by the first 8 characters of its live-stt ref. Counters are per process (per Fly machine); a rollup
 * line is logged every minute while something changed, so `fly logs | grep LiveSttMetrics` is the dashboard.
 */

type Labels = Record<string, string | number | undefined>;

const counters = new Map<string, number>();
interface Summary { count: number; sumMs: number; maxMs: number; buckets: number[] }
const summaries = new Map<string, Summary>();
/** Upper bounds in ms; the last bucket is "more". Chosen to separate Soniox (~0.5-2 s) from Recall's backlog (tens of seconds). */
export const LAG_BUCKETS_MS = [1000, 2000, 5000, 15000, 60000];

function key(name: string, labels?: Labels): string {
  if (!labels) return name;
  const parts = Object.keys(labels).sort().filter((k) => labels[k] !== undefined).map((k) => `${k}=${String(labels[k]).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 40)}`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

export function inc(name: string, labels?: Labels, n = 1): void {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + n);
  dirty = true;
}

export function observeMs(name: string, ms: number, labels?: Labels): void {
  if (!Number.isFinite(ms)) return;
  const v = Math.max(0, ms);
  const k = key(name, labels);
  let s = summaries.get(k);
  if (!s) { s = { count: 0, sumMs: 0, maxMs: 0, buckets: new Array(LAG_BUCKETS_MS.length + 1).fill(0) }; summaries.set(k, s); }
  s.count += 1;
  s.sumMs += v;
  s.maxMs = Math.max(s.maxMs, v);
  let i = LAG_BUCKETS_MS.findIndex((b) => v <= b);
  if (i < 0) i = LAG_BUCKETS_MS.length;
  s.buckets[i]! += 1;
  dirty = true;
}

export function getCounter(name: string, labels?: Labels): number {
  return counters.get(key(name, labels)) ?? 0;
}

export function snapshot(): { counters: Record<string, number>; latency: Record<string, { count: number; meanMs: number; maxMs: number; buckets: number[] }> } {
  const latency: Record<string, { count: number; meanMs: number; maxMs: number; buckets: number[] }> = {};
  for (const [k, s] of summaries) latency[k] = { count: s.count, meanMs: Math.round(s.sumMs / s.count), maxMs: Math.round(s.maxMs), buckets: [...s.buckets] };
  return { counters: Object.fromEntries(counters), latency };
}

/** Test hook. */
export function resetLiveSttMetrics(): void {
  counters.clear();
  summaries.clear();
  dirty = false;
}

/** One structured line per event: `[LiveStt] {"evt":"fallback",...}`. Only fixed-vocabulary fields; never text or names. */
export function logEvent(evt: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void {
  const clean: Record<string, unknown> = { evt };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) clean[k] = typeof v === 'string' ? v.slice(0, 80) : v;
  console.log(`[LiveStt] ${JSON.stringify(clean)}`);
}

/** First 8 characters of a ref: enough to correlate log lines, not enough to use as an ingest ref. */
export function refTag(ref: string | null | undefined): string {
  return (ref ?? '').slice(0, 8);
}

let dirty = false;
let timer: NodeJS.Timeout | null = null;

/** Log the rollup every `intervalMs` while counters changed. Safe to call twice. The timer never keeps the process alive. */
export function startLiveSttMetricsLog(intervalMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    console.log(`[LiveSttMetrics] ${JSON.stringify(snapshot())}`);
  }, intervalMs);
  timer.unref?.();
}

export function stopLiveSttMetricsLog(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
