import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveDb } from './helpers-liveDb.js';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';
process.env.RECALL_API_KEY = 'recall-test-key';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: (t: string) => h.db.from(t) } }));

const adm = await import('../src/lib/liveSttAdmission.js');
const metrics = await import('../src/lib/liveSttMetrics.js');

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
let db: LiveDb;
beforeEach(() => { db = new LiveDb(); h.db = db; metrics.resetLiveSttMetrics(); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

const run = (o: Record<string, unknown>) => db.seed('bot_runs', { user_id: 'u1', status: 'completed', live_stt_provider: 'recall', duration_seconds: null, joined_at: null, left_at: null, created_at: iso(NOW - 3600_000), ...o });

describe('capacity: a 4th concurrent Soniox meeting is not sent to Soniox', () => {
  it('counts only active Soniox runs from the last 6 hours', async () => {
    run({ live_stt_provider: 'soniox', status: 'recording' });
    run({ live_stt_provider: 'soniox', status: 'in_call' });
    run({ live_stt_provider: 'soniox', status: 'completed' });
    run({ live_stt_provider: 'recall', status: 'recording' });
    run({ live_stt_provider: 'shadow', status: 'recording' });
    run({ live_stt_provider: 'soniox', status: 'recording', created_at: iso(NOW - 7 * 3600_000) }); // stale
    expect(await adm.countActiveSonioxRuns(NOW)).toBe(2);
  });
  it('room below the cap, none at the cap (default 3), configurable', async () => {
    const cfg = adm.admissionConfigFrom({});
    expect(cfg.maxConcurrent).toBe(3);
    for (let i = 0; i < 2; i++) run({ live_stt_provider: 'soniox', status: 'recording' });
    expect(await adm.sonioxHasCapacity(cfg, NOW)).toEqual({ ok: true, active: 2 });
    run({ live_stt_provider: 'soniox', status: 'joining' });
    expect(await adm.sonioxHasCapacity(cfg, NOW)).toEqual({ ok: false, active: 3 });
    expect((await adm.sonioxHasCapacity(adm.admissionConfigFrom({ LIVE_STT_MAX_CONCURRENT: '5' }), NOW)).ok).toBe(true);
  });
  it('a failed count answers "no room" (a Recall transcript bot is the safe choice)', async () => {
    db.missing.add('bot_runs.id');
    expect(await adm.sonioxHasCapacity(adm.admissionConfigFrom({}), NOW)).toEqual({ ok: false, active: null });
    expect(metrics.getCounter('live_stt_capacity_check_failed')).toBe(1);
  });
});

describe('guardrails are off by default and make no query', () => {
  it('no env = admitted without touching the database', async () => {
    const spy = vi.spyOn(db, 'from');
    expect(await adm.checkAdmission('u1', adm.admissionConfigFrom({}), NOW)).toEqual({ ok: true });
    expect(spy).not.toHaveBeenCalled();
    await expect(adm.assertAdmitted('u1', adm.admissionConfigFrom({}))).resolves.toBeUndefined();
  });
  it('invalid values (0, negative, text) leave a guardrail off', () => {
    const c = adm.admissionConfigFrom({ LIVE_STT_DAILY_BLOCK_USD: '0', LIVE_STT_MONTHLY_BLOCK_USD: '-3', LIVE_STT_USER_HOURS_BLOCK: 'abc' });
    expect(adm.guardrailsEnabled(c)).toBe(false);
  });
});

describe('cost model and usage', () => {
  it('prices a bot hour by path: Recall 0.65, Soniox 0.62 (0.77 with hot standby), shadow 0.77', () => {
    expect(adm.runCostUsd(1, 'recall', false)).toBeCloseTo(0.65, 5);
    expect(adm.runCostUsd(1, null, false)).toBeCloseTo(0.65, 5);
    expect(adm.runCostUsd(1, 'soniox', false)).toBeCloseTo(0.62, 5);
    expect(adm.runCostUsd(1, 'soniox', true)).toBeCloseTo(0.77, 5);
    expect(adm.runCostUsd(1, 'shadow', false)).toBeCloseTo(0.77, 5);
  });
  it('hours: joined..left span, elapsed for a bot still in the call (capped at 6 h), else duration_seconds', () => {
    expect(adm.runHours({ status: 'completed', duration_seconds: 9999, joined_at: iso(NOW - 7200_000), left_at: iso(NOW - 3600_000) }, NOW)).toBeCloseTo(1, 5);
    expect(adm.runHours({ status: 'recording', duration_seconds: null, joined_at: iso(NOW - 1800_000), left_at: null }, NOW)).toBeCloseTo(0.5, 5);
    expect(adm.runHours({ status: 'recording', duration_seconds: null, joined_at: iso(NOW - 20 * 3600_000), left_at: null }, NOW)).toBe(6);
    expect(adm.runHours({ status: 'completed', duration_seconds: 5400, joined_at: null, left_at: null }, NOW)).toBeCloseTo(1.5, 5);
    expect(adm.runHours({ status: 'failed', duration_seconds: null, joined_at: null, left_at: null }, NOW)).toBe(0);
  });
});

describe('guardrails when configured', () => {
  const fourHours = { joined_at: iso(NOW - 5 * 3600_000), left_at: iso(NOW - 3600_000) };
  it('daily block: 4 Soniox hours today is 2.48 USD; blocks at 2, not at 3', async () => {
    run({ live_stt_provider: 'soniox', ...fourHours, created_at: iso(NOW - 5 * 3600_000) });
    const r = await adm.checkAdmission('u2', adm.admissionConfigFrom({ LIVE_STT_DAILY_BLOCK_USD: '2' }), NOW);
    expect(r).toMatchObject({ ok: false, code: 'BOT_DAILY_BUDGET_REACHED' });
    expect(r.usage!.dayUsd).toBeCloseTo(2.48, 2);
    expect((await adm.checkAdmission('u2', adm.admissionConfigFrom({ LIVE_STT_DAILY_BLOCK_USD: '3' }), NOW)).ok).toBe(true);
    expect(metrics.getCounter('live_stt_guard_blocked', { code: 'BOT_DAILY_BUDGET_REACHED' })).toBe(1);
  });
  it('the daily window is the UTC day; earlier days count toward the month only', async () => {
    run({ live_stt_provider: 'soniox', ...fourHours, created_at: iso(NOW - 3 * 86_400_000) });
    expect((await adm.checkAdmission('u2', adm.admissionConfigFrom({ LIVE_STT_DAILY_BLOCK_USD: '1' }), NOW)).ok).toBe(true);
    expect(await adm.checkAdmission('u2', adm.admissionConfigFrom({ LIVE_STT_MONTHLY_BLOCK_USD: '1' }), NOW)).toMatchObject({ ok: false, code: 'BOT_MONTHLY_BUDGET_REACHED' });
  });
  it('last month does not count', async () => {
    run({ live_stt_provider: 'soniox', ...fourHours, created_at: iso(Date.UTC(2026, 9, 30)) });
    expect((await adm.checkAdmission('u2', adm.admissionConfigFrom({ LIVE_STT_MONTHLY_BLOCK_USD: '1' }), NOW)).ok).toBe(true);
  });
  it('per-user hours: blocks that user only', async () => {
    run({ user_id: 'heavy', ...fourHours });
    const cfg = adm.admissionConfigFrom({ LIVE_STT_USER_HOURS_BLOCK: '3' });
    expect(await adm.checkAdmission('heavy', cfg, NOW)).toMatchObject({ ok: false, code: 'BOT_USER_HOURS_REACHED' });
    expect((await adm.checkAdmission('light', cfg, NOW)).ok).toBe(true);
  });
  it('warn thresholds log and count but admit', async () => {
    run({ user_id: 'heavy', ...fourHours });
    const r = await adm.checkAdmission('heavy', adm.admissionConfigFrom({ LIVE_STT_DAILY_WARN_USD: '1', LIVE_STT_USER_HOURS_WARN: '2' }), NOW);
    expect(r.ok).toBe(true);
    expect(metrics.getCounter('live_stt_guard_warn', { kind: 'daily' })).toBe(1);
    expect(metrics.getCounter('live_stt_guard_warn', { kind: 'user_hours' })).toBe(1);
  });
  it('fails OPEN when the lookup fails', async () => {
    db.missing.add('bot_runs.duration_seconds');
    expect(await adm.checkAdmission('u1', adm.admissionConfigFrom({ LIVE_STT_DAILY_BLOCK_USD: '1' }), NOW)).toEqual({ ok: true });
    expect(metrics.getCounter('live_stt_guard_lookup_failed')).toBe(1);
  });
  it('assertAdmitted throws the AppError the routes render: 403 for a user, 503 for the global breaker', async () => {
    run({ user_id: 'heavy', ...fourHours, created_at: iso(Date.now() - 1000) });
    await expect(adm.assertAdmitted('heavy', adm.admissionConfigFrom({ LIVE_STT_USER_HOURS_BLOCK: '3' }))).rejects.toMatchObject({ statusCode: 403, code: 'BOT_USER_HOURS_REACHED' });
    await expect(adm.assertAdmitted('x', adm.admissionConfigFrom({ LIVE_STT_MONTHLY_BLOCK_USD: '1' }))).rejects.toMatchObject({ statusCode: 503, code: 'BOT_MONTHLY_BUDGET_REACHED' });
  });
});
