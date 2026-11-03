import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

// Records every call so the tests can assert the reader filters and the transcript row written by the stitcher.
const log: Array<{ table: string; ops: Array<[string, any[]]> }> = [];
const inserts: Array<{ table: string; row: any }> = [];
let liveRows: any[] = [];
let botRunProvider: string | null = null;

function chain(table: string) {
  const entry = { table, ops: [] as Array<[string, any[]]> };
  log.push(entry);
  const q: any = {};
  for (const m of ['select', 'eq', 'order', 'range', 'update', 'limit', 'not', 'lt', 'in', 'neq']) {
    q[m] = vi.fn((...a: any[]) => { entry.ops.push([m, a]); return q; });
  }
  q.insert = vi.fn((row: any) => { inserts.push({ table, row }); entry.ops.push(['insert', [row]]); return Promise.resolve({ error: null }); });
  const result = () => {
    if (table === 'live_transcripts') return { data: liveRows, error: null };
    if (table === 'bot_runs') return { data: botRunProvider === null ? [] : [{ live_stt_provider: botRunProvider }], error: null };
    return { data: null, error: null };
  };
  q.maybeSingle = vi.fn(async () => (table === 'bot_runs' ? { data: botRunProvider === null ? null : { live_stt_provider: botRunProvider }, error: null } : { data: null, error: null }));
  q.single = q.maybeSingle;
  q.then = (res: any, rej: any) => Promise.resolve(result()).then(res, rej);
  return q;
}
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: vi.fn((t: string) => chain(t)) } }));
vi.mock('../src/services/recallService.js', () => ({ finalizeBotRecording: vi.fn() }));
vi.mock('../src/services/processingService.js', () => ({ triggerProcessing: vi.fn() }));

const { fetchAllFinalizedSegments, stitchStuckRecording } = await import('../src/services/stuckMeetingRecovery.js');

beforeEach(() => {
  log.length = 0;
  inserts.length = 0;
  liveRows = [
    { segment_text: 'Hello there', speaker_name: 'Ada', speaker_id: '1', is_host: true, start_timestamp: 0, end_timestamp: 2 },
    { segment_text: 'Hi Ada', speaker_name: null, speaker_id: '2', is_host: false, start_timestamp: 3, end_timestamp: 4 },
  ];
  botRunProvider = null;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('stuckMeetingRecovery with live-stt rows', () => {
  it('fetchAllFinalizedSegments excludes shadow rows (and still partials)', async () => {
    await fetchAllFinalizedSegments('meet-1');
    const ops = log.find((l) => l.table === 'live_transcripts')!.ops;
    expect(ops).toContainEqual(['eq', ['is_partial', false]]);
    expect(ops).toContainEqual(['eq', ['shadow', false]]);
  });

  it('stitches soniox-sourced rows exactly like Recall rows (same row shape) and labels the provider', async () => {
    botRunProvider = 'soniox';
    const r = await stitchStuckRecording('rec-1', 'meet-1');
    expect(r.stitched).toBe(true);
    const t = inserts.find((i) => i.table === 'transcripts')!.row;
    expect(t.transcription_provider).toBe('soniox_realtime');
    expect(t.full_text).toContain('Ada: Hello there');
    expect(t.full_text).toContain('Speaker 2: Hi Ada');
    expect(t.speaker_count).toBe(2);
  });

  it('with the default provider (no live_stt run) the stitched transcript is labelled recall_realtime as before', async () => {
    botRunProvider = null;
    await stitchStuckRecording('rec-1', 'meet-1');
    const t = inserts.find((i) => i.table === 'transcripts')!.row;
    expect(t.transcription_provider).toBe('recall_realtime');
    expect(t.transcription_model).toBe('recall_streaming');
    expect(t.language).toBe('en');
  });

  it('a shadow run keeps the recall_realtime label (Recall is still the source of truth)', async () => {
    botRunProvider = 'shadow';
    await stitchStuckRecording('rec-1', 'meet-1');
    expect(inserts.find((i) => i.table === 'transcripts')!.row.transcription_provider).toBe('recall_realtime');
  });

  it('no live segments (soniox service never delivered): reports no_live_segments, writes nothing, does not throw', async () => {
    liveRows = [];
    botRunProvider = 'soniox';
    expect(await stitchStuckRecording('rec-1', 'meet-1')).toEqual({ stitched: false, reason: 'no_live_segments' });
    expect(inserts.find((i) => i.table === 'transcripts')).toBeUndefined();
  });
});
