// generateSummaryWithAnthropic wiring: real prompts, mocked Anthropic client, feature labels and stop_reason pass-through.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const create = vi.fn();
const features: string[] = [];

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  },
}));
vi.mock('../src/config/index.js', () => ({
  config: { ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_MODEL: 'claude-sonnet-4-6', SUMMARY_MODEL: 'claude-haiku-4-5-20251001' },
}));
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));
vi.mock('../src/services/integrationsService.js', () => ({ dispatchRecordingCompleted: vi.fn() }));
vi.mock('../src/lib/llm.js', () => ({
  instrumentAnthropic: <T>(c: T) => c,
  withFeature: <T>(name: string, fn: () => T) => (features.push(name), fn()),
}));

const { generateSummaryWithAnthropic } = await import('../src/services/processingService.js');

const GOOD = JSON.stringify({ summary: 'S', key_points: ['k'], action_items: [], topics: [] });
const reply = (text: string, stop_reason = 'end_turn') => ({ content: [{ type: 'text', text }], stop_reason });

function segs(count: number, size: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    speaker_label: i % 2 ? 'Bob' : 'Ann',
    speaker_index: i % 2,
    text: `TURN-${i} ` + 'w'.repeat(size),
    start_time: i * 10,
    end_time: i * 10 + 9,
    confidence: 1,
  }));
}

beforeEach(() => {
  create.mockReset();
  features.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('generateSummaryWithAnthropic', () => {
  it('short meeting: one "summary" call, model + 8192 cap, speaker-formatted transcript', async () => {
    create.mockResolvedValue(reply(GOOD));
    const s = segs(20, 100);
    const out = await generateSummaryWithAnthropic('', s as any, 'es', 'general', 'rec-1');
    expect(create).toHaveBeenCalledTimes(1);
    const p = create.mock.calls[0][0];
    expect(p.model).toBe('claude-haiku-4-5-20251001'); // summaries run on SUMMARY_MODEL, not the Q&A model
    expect(p.max_tokens).toBe(8192);
    expect(p.messages[0].content).toContain('[0:00] Ann: TURN-0 ');
    expect(p.messages[0].content).toContain('[3:10] Bob: TURN-19 ');
    expect(p.messages[0].content).toContain('in Spanish');
    expect(features).toEqual(['summary']);
    expect(out.summary).toBe('S');
  });

  it('long meeting: chunk calls labelled summary_chunk, one summary_merge, end of transcript covered, nothing truncated', async () => {
    create.mockImplementation(async (p: any) => (p.max_tokens === 2048 ? reply('notes') : reply(GOOD)));
    const s = segs(500, 600); // ~ 305k chars
    await generateSummaryWithAnthropic('', s as any, null, 'general', 'rec-2');
    const chunkCalls = create.mock.calls.filter((c) => c[0].max_tokens === 2048);
    expect(chunkCalls.length).toBeGreaterThanOrEqual(5);
    expect(features.filter((f) => f === 'summary_chunk')).toHaveLength(chunkCalls.length);
    expect(features.filter((f) => f === 'summary_merge')).toHaveLength(1);
    expect(features).not.toContain('summary');
    expect(chunkCalls[chunkCalls.length - 1][0].messages[0].content).toContain('TURN-499 ');
    expect(chunkCalls[0][0].messages[0].content).toContain('TURN-0 ');
  });

  it('passes the real stop_reason through: max_tokens then valid JSON = 2 calls, retry result used', async () => {
    create.mockResolvedValueOnce(reply('{"summary":"cut', 'max_tokens')).mockResolvedValueOnce(reply(GOOD));
    const out = await generateSummaryWithAnthropic('', segs(5, 50) as any, null, 'general', 'rec-3');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].messages[0].content).toContain('Return only valid JSON');
    expect(out.summary).toBe('S');
    expect(features).toEqual(['summary', 'summary']);
  });

  it('two bad replies: falls back to the raw text, does not throw', async () => {
    create.mockResolvedValue(reply('plain prose'));
    const out = await generateSummaryWithAnthropic('', segs(5, 50) as any, null, 'general', 'rec-4');
    expect(create).toHaveBeenCalledTimes(2);
    expect(out.summary).toBe('plain prose');
  });
});
