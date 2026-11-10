import { describe, it, expect, vi, beforeEach } from 'vitest';

const reportFailure = vi.fn();
const reportBackendError = vi.fn();
let table: Record<string, any> = {};

vi.mock('../src/lib/failureReporter.js', () => ({
  reportFailure: (...a: any[]) => reportFailure(...a),
  reportBackendError: (...a: any[]) => reportBackendError(...a),
}));
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (t: string) => {
      const q: any = {};
      for (const m of ['select', 'in', 'lt', 'gte', 'eq', 'limit', 'or']) q[m] = () => q;
      q.then = (res: any, rej: any) => Promise.resolve(table[t] ?? { data: [], count: 0, error: null }).then(res, rej);
      return q;
    },
  },
}));

const alerts = await import('../src/lib/alerts.js');
const loops = await import('../src/lib/loopMonitor.js');
const { serverErrorReporter, normalizePath, REPORTED } = await import('../src/middleware/serverErrorReporter.js');
const { checkStartupConfig, findMissingConfig } = await import('../src/lib/startupConfig.js');
const { checkPipelineInvariants } = await import('../src/services/pipelineInvariants.js');
const { generateSummary } = await import('../src/services/summaryGeneration.js');
const { instrumentAnthropic } = await import('../src/lib/llm.js');

beforeEach(() => {
  reportFailure.mockClear();
  reportBackendError.mockClear();
  alerts.resetAlertThrottle();
  loops.resetLoopMonitor();
  table = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('reportAlert', () => {
  it('sends a stable message with only string context, and throttles repeats', () => {
    expect(alerts.reportAlert('x_flow', 'SOME_CODE', { count: 3, secret: undefined, long: 'a'.repeat(200) })).toBe(true);
    expect(alerts.reportAlert('x_flow', 'SOME_CODE', { count: 4 })).toBe(false);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    const [flow, err, ctx] = reportFailure.mock.calls[0];
    expect(flow).toBe('x_flow');
    expect(err.message).toBe('x_flow: SOME_CODE');
    expect(ctx).toEqual({ code: 'SOME_CODE', count: '3', long: 'a'.repeat(80) });
    expect(alerts.reportAlert('x_flow', 'OTHER_CODE')).toBe(true);
  });
});

describe('classifyProviderError', () => {
  it.each([
    [{ status: 401, message: 'x' }, 'AUTH'],
    [{ message: 'Deepgram API error: 403 - forbidden' }, 'AUTH'],
    [{ status: 400, message: 'Your credit balance is too low to access the Anthropic API' }, 'CREDIT'],
    [{ status: 402 }, 'CREDIT'],
    [{ status: 429 }, 'RATE_LIMIT'],
    [{ name: 'TimeoutError', message: 'The operation timed out' }, 'TIMEOUT'],
    [{ status: 529, message: 'Overloaded' }, 'SERVER'],
    [{ message: 'Recall API error: 503 - down' }, 'SERVER'],
    [{ message: 'fetch failed', code: 'ECONNRESET' }, 'NETWORK'],
    [{ status: 422 }, 'CLIENT'],
    [new Error('weird'), 'UNKNOWN'],
  ])('%j -> %s', (err, cls) => {
    expect(alerts.classifyProviderError(err)).toBe(cls);
  });

  it('a dead key raises one provider-wide alert; other classes use provider_error; our own aborts are ignored', () => {
    alerts.reportProviderFailure('deepgram', { status: 401 });
    alerts.reportProviderFailure('deepgram', { status: 401 });
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0][0]).toBe('provider_unavailable');
    expect(reportFailure.mock.calls[0][1].message).toBe('provider_unavailable: DEEPGRAM_AUTH');
    alerts.reportProviderFailure('anthropic', { status: 429 });
    expect(reportFailure.mock.calls[1][0]).toBe('provider_error');
    reportFailure.mockClear();
    alerts.reportProviderFailure('anthropic', { name: 'APIUserAbortError', message: 'Request was aborted.' });
    expect(reportFailure).not.toHaveBeenCalled();
  });
});

describe('Anthropic client watcher (lib/llm.ts)', () => {
  it('reports a rejected key and still rejects with the original error', async () => {
    const boom = Object.assign(new Error('invalid x-api-key'), { status: 401 });
    const client: any = { messages: { create: vi.fn(() => Promise.reject(boom)) } };
    instrumentAnthropic(client);
    await expect(client.messages.create({ model: 'm', max_tokens: 1, messages: [] })).rejects.toBe(boom);
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalled());
    expect(reportFailure.mock.calls[0][1].message).toBe('provider_unavailable: ANTHROPIC_AUTH');
  });
  it('is silent on success and idempotent', async () => {
    const client: any = { messages: { create: vi.fn(async () => ({ ok: 1 })) } };
    instrumentAnthropic(instrumentAnthropic(client));
    await expect(client.messages.create({})).resolves.toEqual({ ok: 1 });
    expect(reportFailure).not.toHaveBeenCalled();
  });
});

describe('serverErrorReporter', () => {
  function run(status: number, opts: { reported?: boolean; url?: string } = {}) {
    const handlers: Record<string, () => void> = {};
    const res: any = { statusCode: status, locals: opts.reported ? { [REPORTED]: true } : {}, on: (e: string, f: () => void) => { handlers[e] = f; } };
    const req: any = { method: 'POST', originalUrl: opts.url ?? '/v1/webhooks/stripe?token=abc', path: '/webhooks/stripe', user: { id: 'u1' } };
    serverErrorReporter(req, res, () => {});
    handlers.finish();
  }
  it('reports a directly-sent 5xx, path only', () => {
    run(500);
    expect(reportBackendError).toHaveBeenCalledTimes(1);
    expect(reportBackendError.mock.calls[0][0].path).toBe('/v1/webhooks/stripe');
    expect(reportBackendError.mock.calls[0][2]).toBe(500);
  });
  it('does not report 2xx/4xx or what errorHandler already reported', () => {
    run(200); run(404); run(401); run(500, { reported: true });
    expect(reportBackendError).not.toHaveBeenCalled();
  });
  it('normalises ids and share tokens in the path', () => {
    expect(normalizePath('/v1/recordings/3f2b8c1e-1111-4222-8333-444455556666/retry')).toBe('/v1/recordings/:id/retry');
    expect(normalizePath('/api/public/shares/abcDEF123/x')).toBe('/api/public/shares/[redacted]/x');
  });
});

describe('background loop monitor', () => {
  it('a pass that throws raises one alert; a good pass records a heartbeat', async () => {
    loops.registerLoop('OrphanRecovery', 300_000);
    await loops.runLoopPass('OrphanRecovery', async () => { throw new Error('db down'); });
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0][1].message).toBe('background_loop_error: ORPHANRECOVERY_PASS_THREW');
    await loops.runLoopPass('OrphanRecovery', async () => {});
    expect(reportFailure).toHaveBeenCalledTimes(1);
  });
  it('a loop with no heartbeat for 3 intervals (min 10 min) is reported stalled; a never-registered loop is too', () => {
    loops.registerLoop('BotJoinReconciler', 60_000);
    loops.registerLoop('StuckRecovery', 300_000);
    const now = Date.now();
    expect(loops.getLoopStatus(now + 5 * 60_000, ['BotJoinReconciler', 'StuckRecovery']).every((s) => !s.stale)).toBe(true);
    const later = now + 20 * 60_000;
    const st = loops.checkLoops(later, ['BotJoinReconciler', 'StuckRecovery', 'OrphanRecovery']);
    expect(st.map((s) => s.stale)).toEqual([true, true, true]);
    const codes = reportFailure.mock.calls.map((c) => c[1].message).sort();
    expect(codes).toEqual([
      'background_loop_stalled: BOTJOINRECONCILER_STALLED',
      'background_loop_stalled: ORPHANRECOVERY_STALLED',
      'background_loop_stalled: STUCKRECOVERY_STALLED',
    ]);
  });
  it('init failure and scan failure are reported', () => {
    loops.reportLoopInitFailure('StuckRecovery');
    loops.reportLoopScanError('OrphanRecovery');
    expect(reportFailure).toHaveBeenCalledTimes(2);
  });
});

describe('startup config', () => {
  it('flags missing secrets by name in production only', () => {
    checkStartupConfig({ NODE_ENV: 'development' } as any);
    expect(reportFailure).not.toHaveBeenCalled();
    const env: any = { NODE_ENV: 'production', DEEPGRAM_API_KEY: 'x' };
    expect(findMissingConfig(env).required).toContain('RESEND_API_KEY');
    checkStartupConfig(env);
    expect(reportFailure.mock.calls.map((c) => c[1].message)).toEqual(['startup_config: MISSING_REQUIRED_SECRETS', 'startup_config: MISSING_FEATURE_SECRETS']);
    expect(reportFailure.mock.calls[0][2].missing).not.toContain('DEEPGRAM_API_KEY');
  });
});

describe('pipeline invariants', () => {
  it('is quiet when healthy', async () => {
    table = { recordings: { data: [], count: 0, error: null }, bot_runs: { data: [], count: 0, error: null } };
    expect(await checkPipelineInvariants()).toEqual([]);
    expect(reportFailure).not.toHaveBeenCalled();
  });
  it('flags stuck recordings and never-joined bots with counts only', async () => {
    table = { recordings: { data: [], count: 2, error: null }, bot_runs: { data: [], count: 1, error: null } };
    const out = await checkPipelineInvariants();
    expect(out.map((o) => o.code)).toContain('STUCK_RECORDINGS');
    expect(out.map((o) => o.code)).toContain('BOT_NEVER_JOINED');
    const ctx = reportFailure.mock.calls.find((c) => c[1].message.endsWith('STUCK_RECORDINGS'))![2];
    expect(ctx).toEqual({ code: 'STUCK_RECORDINGS', count: '2' });
  });
  it('a database error in the scan is a scan failure, not silence', async () => {
    table = { recordings: { data: null, count: null, error: { message: 'x' } } };
    await checkPipelineInvariants();
    expect(reportFailure.mock.calls[0][1].message).toBe('background_loop_error: PIPELINEINVARIANTS_SCAN_FAILED');
  });
});

describe('degraded summaries', () => {
  it('raises an alert when the reply is unusable after the retry (it is stored as a normal completed summary)', async () => {
    const complete = vi.fn(async () => ({ text: 'not json at all', stopReason: 'end_turn' as const }));
    await generateSummary({ turns: ['Speaker 1: hello'], speakers: ['Speaker 1'], complete, model: 'haiku' } as any);
    expect(complete).toHaveBeenCalledTimes(2);
    const hit = reportFailure.mock.calls.find((c) => c[0] === 'summary_degraded');
    expect(hit?.[1].message).toBe('summary_degraded: REPLY_NOT_PARSEABLE');
    expect(hit?.[2]).toEqual({ code: 'REPLY_NOT_PARSEABLE', kind: 'summary', model: 'haiku', stop_reason: 'end_turn' });
  });
  it('is silent for a good summary', async () => {
    const complete = vi.fn(async () => ({ text: JSON.stringify({ summary: 's', keyPoints: [], actionItems: [], topics: [] }), stopReason: 'end_turn' as const }));
    await generateSummary({ turns: ['Speaker 1: hello'], speakers: ['Speaker 1'], complete, model: 'haiku' } as any);
    expect(reportFailure).not.toHaveBeenCalled();
  });
});
