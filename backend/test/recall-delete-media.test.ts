import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));
vi.mock('../src/services/processingService.js', () => ({ triggerProcessing: vi.fn() }));
vi.mock('../src/lib/alerts.js', () => ({ reportProviderHttpFailure: vi.fn() }));
vi.mock('../src/config/index.js', () => ({ config: { RECALL_API_KEY: 'test-key', RECALL_REGION: 'us-west-2', STORAGE_BUCKET_AUDIO: 'recordings-audio' } }));

const { RecallService } = await import('../src/services/recallService.js');

const calls: { url: string; method: string }[] = [];
function stubFetch(status: number) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init?.method) });
    return new Response('{}', { status });
  }));
}
beforeEach(() => { calls.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('RecallService.deleteBotMedia', () => {
  it('POSTs /bot/{id}/delete_media/ and maps 200 to deleted', async () => {
    stubFetch(200);
    expect(await RecallService.deleteBotMedia('abc')).toBe('deleted');
    expect(calls[0]).toEqual({ url: 'https://us-west-2.recall.ai/api/v1/bot/abc/delete_media/', method: 'POST' });
  });
  it('404 = already gone, 409 = deletion already in progress, 400 = bot still in progress (stay pending)', async () => {
    stubFetch(404); expect(await RecallService.deleteBotMedia('abc')).toBe('not_found');
    stubFetch(409); expect(await RecallService.deleteBotMedia('abc')).toBe('in_progress');
    stubFetch(400); expect(await RecallService.deleteBotMedia('abc')).toBe('in_progress');
  });
  it('other failures throw (so the purge keeps the item pending and alerts)', async () => {
    stubFetch(500);
    await expect(RecallService.deleteBotMedia('abc')).rejects.toThrow(/500/);
    stubFetch(401);
    await expect(RecallService.deleteBotMedia('abc')).rejects.toThrow(/401/);
  });
  it('rejects ids that are not plain tokens (no path injection)', async () => {
    stubFetch(200);
    await expect(RecallService.deleteBotMedia('../x')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('RecallService.stopBot', () => {
  it('tries cancel-scheduled then leave-call and never throws on 4xx', async () => {
    stubFetch(400);
    await expect(RecallService.stopBot('abc')).resolves.toBeUndefined();
    expect(calls.map((c) => `${c.method} ${c.url.split('/api/v1')[1]}`)).toEqual(['DELETE /bot/abc', 'POST /bot/abc/leave_call/']);
  });
  it('does not throw on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    await expect(RecallService.stopBot('abc')).resolves.toBeUndefined();
  });
});
