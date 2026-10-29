// Claude spend accounting. The Anthropic SDK is real; only the network (global fetch) is faked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('../src/config/index.js', () => ({
  config: { ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_MODEL: 'claude-sonnet-4-6', SUMMARY_MODEL: 'claude-haiku-4-5-20251001', ANTHROPIC_MAX_TOKENS: 1024, QA_MAX_CONTEXT_TOKENS: 5000, QA_MAX_RELEVANT_SEGMENTS: 5 },
}));

type Sent = { key: string; items: Array<Record<string, any>> };
let sent: Sent[];
let urls: string[];
let usageMode: 'ok' | 'throws' | '500' | '401' | 'hangs';

const segments = [{ id: 's1', start_time: 0, end_time: 5, speaker_label: 'A', text: 'we agreed to ship on friday' }] as any;

beforeEach(() => {
  sent = []; urls = []; usageMode = 'ok';
  vi.resetModules();
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input.url);
    urls.push(url);
    if (url.startsWith('https://usage.test')) {
      if (usageMode === 'hangs') return new Promise<Response>(() => {});
      if (usageMode === 'throws') throw new Error('worker down');
      sent.push({ key: init.headers['X-Report-Key'], items: JSON.parse(init.body).items });
      return new Response('{}', { status: usageMode === '500' ? 500 : usageMode === '401' ? 401 : 200 });
    }
    if (url.includes('api.anthropic.com')) {
      return new Response(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify({ answer: 'SECRET-ANSWER', citations: [], confidence: 0.9 }) }],
        usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected fetch ' + url);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function enable() {
  vi.stubEnv('LLM_USAGE_KEY', 'test-ingest-key');
  vi.stubEnv('LLM_USAGE_URL', 'https://usage.test/v1/llm');
}
function disable() {
  vi.stubEnv('LLM_USAGE_KEY', '');
  vi.stubEnv('FAILURE_REPORTER_KEY', '');
}

describe('with an ingest key', () => {
  it('records a Q&A call under the "qa" label with tokens and cost, sent with the key', async () => {
    enable();
    const { answerQuestion } = await import('../src/services/llmService.js');
    const { llm } = await import('../src/lib/llm.js');
    const res = await answerQuestion('why?', segments);
    expect(res.answer).toBe('SECRET-ANSWER');
    await llm.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].key).toBe('test-ingest-key');
    const [it0] = sent[0].items;
    expect(sent[0].items).toHaveLength(1);
    expect(it0.feature).toBe('qa');
    expect(it0.model).toBe('claude-sonnet-4-6');
    expect(it0.calls).toBe(1);
    expect(it0.input_tokens).toBe(1000);
    expect(it0.output_tokens).toBe(500);
    expect(it0.cache_read_tokens).toBe(200);
    expect(it0.cost_usd).toBeCloseTo((1000 * 3 + 500 * 15 + 200 * 0.3) / 1e6, 9);
  });

  it('sends only low-cardinality fields: no question, answer or id', async () => {
    enable();
    const { answerQuestion } = await import('../src/services/llmService.js');
    const { llm } = await import('../src/lib/llm.js');
    await answerQuestion('SECRET-QUESTION', segments);
    await llm.flush();
    const body = JSON.stringify(sent);
    expect(body).not.toContain('SECRET');
    for (const it0 of sent.flatMap((s) => s.items)) {
      expect(Object.keys(it0).sort()).toEqual(['cache_read_tokens', 'cache_write_tokens', 'calls', 'cost_usd', 'day', 'errors', 'feature', 'input_tokens', 'model', 'output_tokens']);
    }
  });

  it('a failing report (worker down, 500, rejected key) never throws into the request', async () => {
    enable();
    const { answerQuestion } = await import('../src/services/llmService.js');
    const { llm } = await import('../src/lib/llm.js');
    for (const mode of ['throws', '500', '401'] as const) {
      usageMode = mode;
      const res = await answerQuestion('q', segments);
      expect(res.answer).toBe('SECRET-ANSWER');
      await expect(llm.flush()).resolves.toBeUndefined();
    }
  });

  it('flushLlmUsage gives up after its cap when the Worker hangs', async () => {
    enable();
    const { answerQuestion } = await import('../src/services/llmService.js');
    const { flushLlmUsage } = await import('../src/lib/llm.js');
    await answerQuestion('q', segments);
    usageMode = 'hangs';
    const t0 = Date.now();
    await flushLlmUsage(150);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('without an ingest key', () => {
  it('is inert: the call works, nothing is recorded, nothing is sent', async () => {
    disable();
    const { answerQuestion } = await import('../src/services/llmService.js');
    const { llm, flushLlmUsage } = await import('../src/lib/llm.js');
    expect(llm.enabled).toBe(false);
    const res = await answerQuestion('q', segments);
    expect(res.answer).toBe('SECRET-ANSWER');
    expect(llm.pending()).toBe(0);
    await flushLlmUsage(100);
    expect(urls.filter((u) => !u.includes('api.anthropic.com'))).toEqual([]);
  });
});

describe('source guard', () => {
  const root = path.join(__dirname, '../src');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [path.join(d, e.name)] : []);

  it('every Anthropic client is instrumented and every messages.create/stream is labelled with the expected feature', () => {
    const expected: Record<string, string[]> = {
      'services/processingService.ts': ['pdf_extract', 'summary_chunk', 'summary_merge', 'summary'],
      'services/llmService.ts': ['qa'],
      'services/intelligenceService.ts': ['intelligence'],
      'services/coachingService.ts': ['coaching'],
      'services/liveInsightsService.ts': ['live_insights', 'live_insights', 'live_insights', 'live_insights'],
    };
    const seen = new Set<string>();
    for (const file of walk(root)) {
      const rel = path.relative(root, file);
      if (rel.startsWith('lib/')) continue;
      const src = fs.readFileSync(file, 'utf8');
      const creates = src.match(/\.messages\.(create|stream)\(/g) || [];
      const clients = src.match(/new Anthropic\(/g) || [];
      if (!creates.length && !clients.length) continue;
      seen.add(rel);
      expect(expected[rel], `${rel} uses Anthropic but is not in the instrumented list`).toBeDefined();
      expect((src.match(/instrumentAnthropic\(new Anthropic\(/g) || []).length, `${rel}: un-instrumented client`).toBe(clients.length);
      const labels = [...src.matchAll(/withFeature\('([a-z_]+)', \(\) => \w+\.messages\.(?:create|stream)\(/g)].map((m) => m[1]);
      expect(labels, `${rel}: labels`).toEqual(expected[rel]);
      expect(labels.length, `${rel}: unlabelled call`).toBe(creates.length);
    }
    expect([...seen].sort()).toEqual(Object.keys(expected).sort());
  });

  it('the shared instance is registered as app "meetingmind" (the app is not in the payload, so check the source)', () => {
    expect(fs.readFileSync(path.join(root, 'lib/llm.ts'), 'utf8')).toMatch(/createLlmUsage\(\{\s*app: 'meetingmind'/);
  });

  it('shutdown flushes usage before exit, and the build ships llmUsage.js', () => {
    const idx = fs.readFileSync(path.join(root, 'index.ts'), 'utf8');
    expect(idx).toMatch(/flushLlmUsage\(2500\)\.finally\(\(\) => process\.exit\(0\)\)/);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, '../package.json'), 'utf8'));
    expect(pkg.scripts.build).toContain('llmUsage.js');
  });
});
