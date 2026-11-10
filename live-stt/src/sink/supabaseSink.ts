import { SinkError, type LiveSegment, type SegmentSink } from './types.js';

export interface SupabaseSinkOptions {
  url: string;
  serviceKey: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface BotRun { id: string; meeting_id: string; user_id: string }

/**
 * Alternative sink: PostgREST insert straight into live_transcripts (what webhooks.ts does today, minus the insight trigger).
 * NOT the default: it needs the service-role key on this app, it cannot call queueInsightGeneration() (in-process in the backend),
 * and live_transcripts has no unique key, so a retry after a timed-out-but-applied insert duplicates rows.
 */
export class SupabaseSink implements SegmentSink {
  readonly name = 'supabase';
  private readonly runs = new Map<string, BotRun>();
  constructor(private readonly o: SupabaseSinkOptions) {}

  private async call(url: string, init: RequestInit): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 8000);
    try {
      return await (this.o.fetchFn ?? fetch)(url, { ...init, signal: ctl.signal });
    } catch (e) {
      throw new SinkError(`supabase network error: ${(e as Error).name}`, true);
    } finally {
      clearTimeout(timer);
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.o.serviceKey, authorization: `Bearer ${this.o.serviceKey}`, 'content-type': 'application/json', ...extra };
  }

  private async botRun(botId: string): Promise<BotRun> {
    const cached = this.runs.get(botId);
    if (cached) return cached;
    const q = `${this.o.url}/rest/v1/bot_runs?select=id,meeting_id,user_id&recall_bot_id=eq.${encodeURIComponent(botId)}&limit=1`;
    const res = await this.call(q, { method: 'GET', headers: this.headers() });
    if (!res.ok) throw new SinkError(`supabase bot lookup status ${res.status}`, res.status >= 500 || res.status === 429, res.status);
    const rows = (await res.json()) as BotRun[];
    const r = rows[0];
    if (!r) throw new SinkError('unknown bot', false, 404);
    if (this.runs.size > 1000) this.runs.clear();
    this.runs.set(botId, r);
    return r;
  }

  async write(batch: LiveSegment[]): Promise<void> {
    if (batch.length === 0) return;
    const botId = batch[0]!.botId;
    if (!botId) throw new SinkError('no bot id', false);
    const run = await this.botRun(botId);
    const rows = batch.map((s) => ({
      meeting_id: run.meeting_id, bot_run_id: run.id, user_id: run.user_id, segment_text: s.segment_text, speaker_id: s.speaker_id,
      speaker_name: s.speaker_name, is_host: s.is_host, start_timestamp: s.start_timestamp, end_timestamp: s.end_timestamp,
      words: s.words, is_partial: false,
    }));
    const res = await this.call(`${this.o.url}/rest/v1/live_transcripts`, { method: 'POST', headers: this.headers({ prefer: 'return=minimal' }), body: JSON.stringify(rows) });
    if (res.ok) return;
    throw new SinkError(`supabase insert status ${res.status}`, res.status >= 500 || res.status === 429, res.status);
  }
}
