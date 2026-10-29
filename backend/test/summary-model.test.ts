// Summaries run on SUMMARY_MODEL (Haiku); the other LLM features keep ANTHROPIC_MODEL. completeText takes an override.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create }; } }));
vi.mock('../src/config/index.js', () => ({
  config: { ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_MODEL: 'claude-sonnet-4-6', SUMMARY_MODEL: 'claude-haiku-4-5-20251001' },
}));
vi.mock('../src/lib/llm.js', () => ({
  instrumentAnthropic: <T>(c: T) => c,
  withFeature: <T>(_n: string, fn: () => T) => fn(),
}));

const { completeText } = await import('../src/services/intelligenceService.js');

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
});

describe('completeText model selection', () => {
  it('uses ANTHROPIC_MODEL by default (follow-up email, cross-meeting chat)', async () => {
    await completeText({ feature: 'follow_up_email', system: 's', user: 'u' });
    expect(create.mock.calls[0][0].model).toBe('claude-sonnet-4-6');
  });

  it('uses the override when given (summary regeneration passes SUMMARY_MODEL)', async () => {
    await completeText({ feature: 'summary', system: 's', user: 'u', model: 'claude-haiku-4-5-20251001' });
    expect(create.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001');
  });
});
