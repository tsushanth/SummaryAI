/**
 * Read-only view of ONE user's past meetings for the voice assistant.
 *
 * Isolation rules (tested in test/voice-assistant-isolation.test.ts):
 *  - A VoiceData is constructed for a single user id that comes from the bot_runs row (server side), never from the
 *    transcript, the webhook body or the model.
 *  - Every read starts from `recordings` filtered by that user_id. Transcripts and summaries are only ever fetched with
 *    `recording_id IN (<that user's recording ids>)`. A meeting key the model asks for that is not in the user's own index is
 *    refused ("no meeting"), whatever id or key it makes up.
 *  - The model sees short per-session keys (m01, m02, ...), not database ids.
 *  - Calendar event titles, descriptions and attendees are not read (DATA_SEGREGATION.md): only recordings, transcripts and
 *    summaries, which are what the app already shows the user.
 */
import { supabaseAdmin } from '../../lib/supabase.js';

export interface MeetingRef {
  key: string;
  date: string; // YYYY-MM-DD
  minutes: number;
  title: string;
  summaryStart: string;
}

export interface SearchHit { meeting: string; date: string; title: string; offset: number; snippet: string }

export interface VoiceData {
  /** Most recent meetings first. */
  index(): Promise<MeetingRef[]>;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  list(filter: { from?: string; to?: string; query?: string; minMinutes?: number }): Promise<Array<{ meeting: string; date: string; minutes: number; title: string; summary: string }>>;
  get(key: string, opts?: { section?: 'summary' | 'transcript'; offset?: number }): Promise<Record<string, unknown>>;
}

const oneLine = (s: unknown, n: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const WINDOW = 700;
const STEP = 500;
const PAGE = 6000;

/** Keyword windows over a transcript, scored by term hits. Pure; shared with the snapshot adapter used by the eval. */
export function searchWindows(
  docs: Array<{ key: string; date: string; title: string; text: string }>,
  query: string,
  limit: number,
): SearchHit[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!terms.length) return [];
  const scored: Array<SearchHit & { s: number }> = [];
  for (const d of docs) {
    for (let off = 0; off < d.text.length; off += STEP) {
      const text = d.text.slice(off, off + WINDOW);
      const low = text.toLowerCase();
      let s = 0;
      for (const t of terms) { let i = -1; while ((i = low.indexOf(t, i + 1)) >= 0) s++; }
      if (s > 0) scored.push({ meeting: d.key, date: d.date, title: d.title, offset: off, snippet: text, s });
    }
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map(({ s: _s, ...hit }) => hit);
}

/** Escape LIKE wildcards so a spoken term is matched literally. */
const likeEscape = (s: string): string => s.replace(/[\\%_,()]/g, ' ');

const INDEX_MAX = 120; // keeps the `IN (...)` list of uuids well inside PostgREST's URL limit
const SEARCH_ROWS = 8;

export function supabaseVoiceData(userId: string, db: typeof supabaseAdmin = supabaseAdmin): VoiceData {
  if (!userId) throw new Error('voice data requires a user id');
  let cache: { at: number; refs: MeetingRef[]; idByKey: Map<string, string>; keyById: Map<string, string> } | null = null;

  async function load() {
    if (cache && Date.now() - cache.at < 60_000) return cache;
    // The ONLY query that names a user: everything else is constrained to the ids it returns.
    const { data: recs, error } = await db
      .from('recordings')
      .select('id, title, created_at, duration_seconds, status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(INDEX_MAX);
    if (error) throw new Error(`voice data: recordings query failed (${error.code ?? 'error'})`);
    const rows = (recs ?? []).filter((r: any) => r.status === 'completed');
    const ids = rows.map((r: any) => r.id as string);
    const summaries = new Map<string, string>();
    if (ids.length) {
      const { data: sums } = await db.from('summaries').select('recording_id, summary').in('recording_id', ids);
      for (const s of sums ?? []) summaries.set((s as any).recording_id, (s as any).summary);
    }
    const idByKey = new Map<string, string>();
    const keyById = new Map<string, string>();
    const refs = rows.map((r: any, i: number): MeetingRef => {
      const key = `m${String(i + 1).padStart(2, '0')}`;
      idByKey.set(key, r.id);
      keyById.set(r.id, key);
      return {
        key,
        date: String(r.created_at).slice(0, 10),
        minutes: Math.round((r.duration_seconds ?? 0) / 60),
        title: oneLine(r.title, 80),
        summaryStart: oneLine(summaries.get(r.id), 150),
      };
    });
    cache = { at: Date.now(), refs, idByKey, keyById };
    return cache;
  }

  return {
    index: async () => (await load()).refs,

    async search(query, limit = 6) {
      const c = await load();
      const ids = [...c.idByKey.values()];
      const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2).slice(0, 4);
      if (!ids.length || !terms.length) return [];
      // Candidate rows by ilike on the user's own transcripts only; windows are scored in memory.
      const { data, error } = await db
        .from('transcripts')
        .select('recording_id, full_text')
        .in('recording_id', ids)
        .or(terms.map((t) => `full_text.ilike.%${likeEscape(t)}%`).join(','))
        .limit(SEARCH_ROWS);
      if (error) throw new Error(`voice data: transcript search failed (${error.code ?? 'error'})`);
      const byKey = new Map(c.refs.map((r) => [r.key, r]));
      const docs = (data ?? [])
        .map((t: any) => ({ key: c.keyById.get(t.recording_id) ?? '', text: String(t.full_text ?? '') }))
        .filter((d) => d.key) // a row outside the user's index is dropped, not returned
        .map((d) => ({ ...d, date: byKey.get(d.key)!.date, title: byKey.get(d.key)!.title }));
      return searchWindows(docs, query, limit);
    },

    async list({ from, to, query, minMinutes }) {
      const c = await load();
      const q = query?.toLowerCase();
      return c.refs
        .filter((m) => (!from || m.date >= from) && (!to || m.date <= to) && (!minMinutes || m.minutes >= minMinutes)
          && (!q || `${m.title} ${m.summaryStart}`.toLowerCase().includes(q)))
        .map((m) => ({ meeting: m.key, date: m.date, minutes: m.minutes, title: m.title, summary: m.summaryStart }));
    },

    async get(key, { section = 'summary', offset = 0 } = {}) {
      const c = await load();
      const id = c.idByKey.get(String(key));
      const ref = c.refs.find((r) => r.key === key);
      if (!id || !ref) return { error: `no meeting ${oneLine(key, 12)}` };
      if (section === 'transcript') {
        const { data } = await db.from('transcripts').select('recording_id, full_text').in('recording_id', [id]).limit(1);
        const row = (data ?? [])[0] as any;
        if (!row || row.recording_id !== id) return { error: 'no transcript' };
        const full = String(row.full_text ?? '');
        const off = Math.max(0, Math.floor(Number(offset) || 0));
        return {
          meeting: key, date: ref.date, title: ref.title, offset: off, text: full.slice(off, off + PAGE),
          nextOffset: off + PAGE < full.length ? off + PAGE : null, totalChars: full.length,
        };
      }
      const { data } = await db.from('summaries')
        .select('recording_id, summary, detailed_summary, key_points, action_items, topics').in('recording_id', [id]).limit(1);
      const s = (data ?? [])[0] as any;
      if (!s || s.recording_id !== id) return { meeting: key, date: ref.date, title: ref.title, minutes: ref.minutes, summary: 'no summary yet' };
      return {
        meeting: key, date: ref.date, title: ref.title, minutes: ref.minutes, summary: s.summary,
        detailedSummary: s.detailed_summary, keyPoints: s.key_points, actionItems: s.action_items, topics: s.topics,
      };
    },
  };
}
