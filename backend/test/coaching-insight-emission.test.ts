import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Drives the real coaching tick loop (startSession -> 30 s ticker -> tick) against a fake Supabase and a fake Claude.
 * The production symptom was coaching_insights = 0 with sessions that claimed otherwise; these tests pin how a tick
 * records what it emits.
 */

const SESSION_ID = 'sess-1';
const state = {
  insertError: null as null | { message: string },
  insertedInsights: [] as any[],
  sessionUpdates: [] as any[],
  sessionInsightCount: 0,
  claudeText: '{"insights":[]}',
  segments: [{ speaker_name: 'Prospect', segment_text: 'We need this by Q1 and budget is approved', end_timestamp: 42 }] as any[],
};

function table(name: string) {
  const q: any = {};
  let op: 'select' | 'insert' | 'update' = 'select';
  let payload: any;
  for (const m of ['select', 'eq', 'gt', 'or', 'order', 'limit', 'is', 'lt']) q[m] = vi.fn(() => q);
  q.insert = vi.fn((p: any) => { op = 'insert'; payload = p; return q; });
  q.update = vi.fn((p: any) => { op = 'update'; payload = p; return q; });
  const result = () => {
    if (name === 'coaching_credits') return { data: { id: 'credit-1', balance: 2 }, error: null };
    if (name === 'coaching_sessions') {
      if (op === 'insert') return { data: { id: SESSION_ID }, error: null };
      if (op === 'update') { state.sessionUpdates.push(payload); return { data: { id: SESSION_ID }, error: null }; }
      return { data: { recording_id: 'rec-1', ended_at: null, insight_count: state.sessionInsightCount }, error: null };
    }
    if (name === 'recordings') return { data: { meeting_id: 'meet-1' }, error: null };
    if (name === 'live_transcripts') return { data: state.segments, error: null };
    if (name === 'coaching_insights') {
      if (op === 'insert') {
        if (state.insertError) return { data: null, error: state.insertError };
        const row = { id: `ins-${state.insertedInsights.length}`, ...payload };
        state.insertedInsights.push(row);
        return { data: row, error: null };
      }
      return { data: [], error: null };
    }
    return { data: null, error: null };
  };
  q.single = () => Promise.resolve(result());
  q.maybeSingle = () => Promise.resolve(result());
  q.then = (res: any, rej: any) => Promise.resolve(result()).then(res, rej);
  return q;
}

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: vi.fn((t: string) => table(t)) } }));
vi.mock('../src/config/index.js', () => ({ config: { ANTHROPIC_API_KEY: 'test-key' } }));
vi.mock('../src/lib/llm.js', () => ({
  instrumentAnthropic: (c: any) => c,
  withFeature: (_n: string, fn: () => any) => fn(),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: async () => ({ content: [{ type: 'text', text: state.claudeText }] }) };
  },
}));

const coaching = await import('../src/services/coachingService.js');

async function runOneTick() {
  await coaching.startSession('user-1', 'rec-1', 'sales_discovery');
  await vi.advanceTimersByTimeAsync(30_000);
  await vi.advanceTimersByTimeAsync(0);
  await coaching.endSession(SESSION_ID); // clears the ticker
}

const insight = (text: string, over: Record<string, string> = {}) => ({ type: 'question', text, urgency: 'now', ...over });

describe('coaching tick: emission and insight_count', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.insertError = null;
    state.insertedInsights = [];
    state.sessionUpdates = [];
    state.sessionInsightCount = 0;
    state.claudeText = '{"insights":[]}';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('persists valid insights and counts exactly those', async () => {
    state.claudeText = JSON.stringify({ insights: [insight('Ask who signs the contract'), insight('Probe the Q1 deadline', { type: 'signal', urgency: 'soon' })] });
    await runOneTick();
    expect(state.insertedInsights).toHaveLength(2);
    expect(state.insertedInsights[0]).toMatchObject({ session_id: SESSION_ID, transcript_offset_seconds: 42 });
    expect(state.sessionUpdates.find(u => 'insight_count' in u)).toEqual({ insight_count: 2 });
  });

  it('does not count insights the validator rejected', async () => {
    state.claudeText = JSON.stringify({ insights: [insight('Valid one'), insight('Bad urgency', { urgency: 'asap' }), insight('x'.repeat(300))] });
    await runOneTick();
    expect(state.insertedInsights).toHaveLength(1);
    expect(state.sessionUpdates.find(u => 'insight_count' in u)).toEqual({ insight_count: 1 });
  });

  it('does not count, and logs, insights whose insert failed (previously swallowed, count inflated)', async () => {
    state.insertError = { message: 'permission denied for table coaching_insights' };
    state.claudeText = JSON.stringify({ insights: [insight('Ask about budget'), insight('Ask about timeline')] });
    await runOneTick();
    expect(state.insertedInsights).toHaveLength(0);
    // With 0 persisted rows the session must not claim insights: no insight_count bump, so the end-of-session auto-refund still applies.
    const bump = state.sessionUpdates.find(u => 'insight_count' in u && u.insight_count > 0);
    expect(bump).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[Coaching] insight insert failed'), expect.anything());
  });

  it('adds to the existing count rather than replacing it', async () => {
    state.sessionInsightCount = 4;
    state.claudeText = JSON.stringify({ insights: [insight('Next step?')] });
    await runOneTick();
    expect(state.sessionUpdates.find(u => 'insight_count' in u)).toEqual({ insight_count: 5 });
  });
});
