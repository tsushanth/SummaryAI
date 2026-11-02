// GET /api/recordings/:id: additive summary_status fields; legacy fields and shape unchanged.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const tables: Record<string, any> = {};
function chain(table: string) {
  const q: any = {};
  for (const m of ['select', 'eq', 'order', 'range']) q[m] = vi.fn(() => q);
  q.single = vi.fn(() => Promise.resolve(tables[table] ?? { data: null, error: { message: 'none' } }));
  q.maybeSingle = q.single;
  q.then = (res: any, rej: any) => Promise.resolve(tables[table]).then(res, rej);
  return q;
}
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((t: string) => chain(t)),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://x/a.m4a' } }) }) },
  },
}));
vi.mock('../src/middleware/auth.js', () => ({
  optionalAuth: (req: any, _res: any, next: any) => { req.user = { id: 'user-1' }; next(); },
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'user-1' }; next(); },
}));
vi.mock('../src/services/processingService.js', () => ({ triggerProcessing: vi.fn() }));
vi.mock('../src/routes/questions.js', async () => ({ default: (await import('express')).Router() }));
vi.mock('../src/config/index.js', () => ({
  config: { MAX_RECORDING_DURATION_SECONDS: 14400, MAX_AUDIO_FILE_SIZE_MB: 500, STORAGE_BUCKET_AUDIO: 'audio' },
}));

const { default: router } = await import('../src/routes/recordings.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

async function get(path: string) {
  const app = express();
  app.use('/api/recordings', router);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}

const rec = (over: any = {}) => ({ id: 'r1', user_id: 'user-1', status: 'completed', error_code: null, file_path: 'u/r1.m4a', duration_seconds: 10, ...over });
beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('GET /api/recordings/:id summary state', () => {
  it('too short: summary key absent (old clients see no summary, as before), new fields present', async () => {
    tables.recordings = { data: rec({ error_code: 'TOO_SHORT' }), error: null };
    tables.transcripts = { data: { id: 't', full_text: 'hi there', segments: [] }, error: null };
    tables.summaries = { data: null, error: { code: 'PGRST116' } };
    const { status, body } = await get('/api/recordings/r1?include=transcript,summary');
    expect(status).toBe(200);
    expect(body.summary).toBeUndefined();
    expect(body.summary_status).toBe('too_short');
    expect(body.summary_message).toMatch(/^Too short to summarize\. Record at least 30 seconds/);
    expect(body.summary_min_seconds).toBe(30);
    expect(body.recording.status).toBe('completed'); // legacy enum value, old clients parse it
    expect(body.transcript.id).toBe('t');
  });

  it('normal recording: summary unchanged and summary_status ready', async () => {
    tables.recordings = { data: rec({ duration_seconds: 600 }), error: null };
    tables.summaries = { data: { id: 's', summary: 'Real summary', key_points: ['a'], action_items: [], topics: [] }, error: null };
    const { body } = await get('/api/recordings/r1?include=summary');
    expect(body.summary.summary).toBe('Real summary');
    expect(body.summary_status).toBe('ready');
    expect(body.summary_message).toBeNull();
  });

  it('too short but the user regenerated a summary: ready', async () => {
    tables.recordings = { data: rec({ error_code: 'TOO_SHORT' }), error: null };
    tables.summaries = { data: { id: 's', summary: 'Regenerated', key_points: [], action_items: [], topics: [] }, error: null };
    const { body } = await get('/api/recordings/r1?include=summary');
    expect(body.summary_status).toBe('ready');
    expect(body.summary.summary).toBe('Regenerated');
  });

  it('too short, summary not requested: still reports too_short after checking for a row', async () => {
    tables.recordings = { data: rec({ error_code: 'NO_SPEECH' }), error: null };
    tables.summaries = { data: null, error: { code: 'PGRST116' } };
    const { body } = await get('/api/recordings/r1');
    expect(body.summary_status).toBe('no_speech');
  });

  it('abandoned upload reports failed_upload with the legacy status failed', async () => {
    tables.recordings = { data: rec({ status: 'failed', error_code: 'FAILED_UPLOAD' }), error: null };
    const { body } = await get('/api/recordings/r1?include=summary');
    expect(body.recording.status).toBe('failed');
    expect(body.summary_status).toBe('failed_upload');
  });
});
