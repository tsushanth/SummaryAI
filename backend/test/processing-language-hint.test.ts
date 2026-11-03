// processRecordingAsync looks up the meeting's language and passes it to the STT provider (Deepgram language=).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

let meetingId: string | null = 'meet-1';
let runLanguage: string | null = 'fr';

function builder(table: string) {
  const q: any = {};
  for (const m of ['select', 'in', 'lt', 'not', 'neq', 'order', 'limit', 'eq']) q[m] = vi.fn(() => q);
  q.update = vi.fn(() => q);
  q.insert = vi.fn(() => Promise.resolve({ error: null }));
  q.single = vi.fn(() => Promise.resolve({ data: { id: 'rec-1', file_path: 'u/r.m4a', content_type: 'audio/mp4', source: 'meeting_bot', duration_seconds: 20, recording_type: 'general', meeting_id: meetingId }, error: null }));
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: table === 'bot_runs' ? { id: 'run-1', status: 'completed', transcription_language: runLanguage } : null, error: null }));
  q.then = (res: any, rej: any) => Promise.resolve({ data: null, error: null, count: 0 }).then(res, rej);
  return q;
}
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: { from: vi.fn((t: string) => builder(t)), storage: { from: () => ({ download: async () => ({ data: new Blob(['audio']), error: null }) }) } },
}));
vi.mock('../src/config/index.js', () => ({ config: { STORAGE_BUCKET_AUDIO: 'audio', ANTHROPIC_API_KEY: 'sk-test', DEEPGRAM_API_KEY: 'dg-test', SUMMARY_MODEL: 'm' } }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ summary: 'S', key_points: ['k'], action_items: [], topics: [] }) }], stop_reason: 'end_turn' }) }; },
}));
vi.mock('../src/lib/llm.js', () => ({ instrumentAnthropic: <T>(c: T) => c, withFeature: <T>(_n: string, fn: () => T) => fn() }));
vi.mock('../src/services/integrationsService.js', () => ({ dispatchRecordingCompleted: vi.fn() }));
vi.mock('../src/lib/alerts.js', async (orig) => ({ ...(await orig<any>()), reportAlert: vi.fn(), reportProviderFailure: vi.fn(), reportProviderHttpFailure: vi.fn() }));

const { triggerProcessing, getActiveProcessingIds } = await import('../src/services/processingService.js');
let urls: string[] = [];
beforeEach(() => {
  urls = []; meetingId = 'meet-1'; runLanguage = 'fr';
  vi.stubEnv('STT_PROVIDER', 'deepgram');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(new URL('./fixtures/stt/deepgram-es-two-speakers.json', import.meta.url), 'utf8')), text: async () => '' };
  }));
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const run = async () => { await triggerProcessing('rec-1', 'user-1'); await vi.waitFor(() => expect(getActiveProcessingIds().size).toBe(0)); };

describe('final transcript uses the meeting language', () => {
  it('chosen language -> Deepgram language=fr', async () => {
    await run();
    expect(urls[0]).toContain('&language=fr');
    expect(urls[0]).not.toContain('detect_language');
  });
  it('auto (NULL on the run) -> detect_language as before', async () => {
    runLanguage = null;
    await run();
    expect(urls[0]).toContain('detect_language=true');
    expect(urls[0]).not.toContain('language=fr');
  });
  it('recording without a meeting (upload) -> detect_language', async () => {
    meetingId = null;
    await run();
    expect(urls[0]).toContain('detect_language=true');
  });
});
