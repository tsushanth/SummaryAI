import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const inserts: Array<{ table: string; row: any }> = [];
let liveRows: any[] = [];
let run: any = null;
let runColumnMissing = false;

function chain(table: string) {
  const q: any = {};
  let cols = '';
  for (const m of ['eq', 'order', 'range', 'update', 'limit', 'not', 'lt', 'in', 'neq']) q[m] = vi.fn(() => q);
  q.select = vi.fn((c: string) => { cols = c ?? ''; return q; });
  q.insert = vi.fn((row: any) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); });
  const botRun = () => {
    if (runColumnMissing && cols.includes('transcription_language')) return { data: null, error: { code: '42703', message: 'column bot_runs.transcription_language does not exist' } };
    return { data: run, error: null };
  };
  q.maybeSingle = vi.fn(async () => (table === 'bot_runs' ? botRun() : { data: null, error: null }));
  q.then = (res: any, rej: any) => Promise.resolve(table === 'live_transcripts' ? { data: liveRows, error: null } : { data: null, error: null }).then(res, rej);
  return q;
}
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: vi.fn((t: string) => chain(t)) } }));
vi.mock('../src/services/recallService.js', () => ({ finalizeBotRecording: vi.fn() }));
vi.mock('../src/services/processingService.js', () => ({ triggerProcessing: vi.fn() }));

const { stitchStuckRecording } = await import('../src/services/stuckMeetingRecovery.js');
const { stitchedLanguage } = await import('../src/lib/transcriptionLanguage.js');

const seg = (text: string, i: number) => ({ segment_text: text, speaker_name: 'Ana', speaker_id: '1', is_host: true, start_timestamp: i * 5, end_timestamp: i * 5 + 4 });
const SPANISH = ['Hola a todos, vamos a empezar la reunión porque tenemos que hablar de los planes', 'Tenemos que decidir el presupuesto para el próximo mes y no hay tiempo'];

beforeEach(() => {
  inserts.length = 0;
  run = null;
  runColumnMissing = false;
  liveRows = SPANISH.map(seg);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
const stitched = async () => { await stitchStuckRecording('rec-1', 'meet-1'); return inserts.find((i) => i.table === 'transcripts')!.row; };

describe('stitchedLanguage (pure)', () => {
  it('uses the explicit language of the run first', () => {
    expect(stitchedLanguage({ explicit: 'fr', provider: 'soniox', fullText: 'hello the and we have', recallAutoDetect: false })).toBe('fr');
    expect(stitchedLanguage({ explicit: 'fr', provider: null, fullText: '', recallAutoDetect: false })).toBe('fr');
  });
  it('Recall transcript without a choice really was English: stays en', () => {
    expect(stitchedLanguage({ explicit: null, provider: null, fullText: 'hola vamos que los', recallAutoDetect: false })).toBe('en');
    expect(stitchedLanguage({ explicit: 'auto', provider: 'shadow', fullText: 'hola vamos que los', recallAutoDetect: false })).toBe('en');
  });
  it('Soniox auto and Recall detection (opt-in) are detected from the text', () => {
    expect(stitchedLanguage({ explicit: null, provider: 'soniox', fullText: SPANISH.join(' '), recallAutoDetect: false })).toBe('es');
    expect(stitchedLanguage({ explicit: null, provider: null, fullText: SPANISH.join(' '), recallAutoDetect: true })).toBe('es');
  });
});

describe('stitchStuckRecording language', () => {
  it('default Recall run: language en (unchanged behaviour)', async () => {
    run = { live_stt_provider: null };
    expect((await stitched()).language).toBe('en');
  });
  it('soniox auto run with Spanish speech: es, not the old hard-coded en', async () => {
    run = { live_stt_provider: 'soniox', transcription_language: null };
    const t = await stitched();
    expect(t.language).toBe('es');
    expect(t.transcription_provider).toBe('soniox_realtime');
  });
  it('a chosen language wins on either path', async () => {
    run = { live_stt_provider: null, transcription_language: 'fr' };
    expect((await stitched()).language).toBe('fr');
    run = { live_stt_provider: 'soniox', transcription_language: 'de' };
    inserts.length = 0;
    expect((await stitched()).language).toBe('de');
  });
  it('before migration 027 the provider label still works (column fallback)', async () => {
    runColumnMissing = true;
    run = { live_stt_provider: 'soniox' };
    const t = await stitched();
    expect(t.transcription_provider).toBe('soniox_realtime');
    expect(t.language).toBe('es');
  });
});
