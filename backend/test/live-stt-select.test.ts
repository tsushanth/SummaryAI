import { describe, it, expect } from 'vitest';
import { liveSttProviderFor, percentBucket, parsePercent } from '../src/lib/liveSttSelect.js';
import { planLiveStt, isFallbackEnabled } from '../src/lib/liveStt.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOL = { LIVE_STT_WS_URL: 'wss://mm-live-stt.example.dev', LIVE_STT_INGEST_SECRET: 'ingest-secret-for-tests' };

describe('liveSttProviderFor: env matrix', () => {
  it('default (nothing set) is recall for everyone: production behaviour unchanged', () => {
    expect(liveSttProviderFor(U1, {})).toEqual({ provider: 'recall', reason: 'default' });
    expect(liveSttProviderFor(undefined, {})).toEqual({ provider: 'recall', reason: 'default' });
  });
  it('the allowlist and percentage are ignored unless LIVE_STT_PROVIDER=auto', () => {
    const env = { LIVE_STT_SONIOX_USER_IDS: U1, LIVE_STT_SONIOX_PERCENT: '100' };
    expect(liveSttProviderFor(U1, env).provider).toBe('recall');
    expect(liveSttProviderFor(U1, { ...env, LIVE_STT_PROVIDER: 'recall' }).provider).toBe('recall');
  });
  it('recall is the instant rollback: it overrides an allowlist and 100 percent', () => {
    const env = { LIVE_STT_PROVIDER: 'recall', LIVE_STT_SONIOX_USER_IDS: U1, LIVE_STT_SONIOX_PERCENT: '100' };
    expect(liveSttProviderFor(U1, env).provider).toBe('recall');
  });
  it('an unknown value is recall (a typo never turns Soniox on)', () => {
    expect(liveSttProviderFor(U1, { LIVE_STT_PROVIDER: 'sonoix' }).provider).toBe('recall');
  });
  it('soniox = every user', () => {
    expect(liveSttProviderFor(U1, { LIVE_STT_PROVIDER: 'soniox' })).toEqual({ provider: 'soniox', reason: 'all' });
    expect(liveSttProviderFor(undefined, { LIVE_STT_PROVIDER: 'soniox' }).provider).toBe('soniox'); // legacy global switch
  });
  it('auto: allowlist only (case-insensitive, whitespace tolerant)', () => {
    const env = { LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_USER_IDS: ` ${OWNER.toUpperCase()} , ${U1}` };
    expect(liveSttProviderFor(OWNER, env)).toEqual({ provider: 'soniox', reason: 'allowlist' });
    expect(liveSttProviderFor({ id: U1 }, env).reason).toBe('allowlist');
    expect(liveSttProviderFor(U2, env)).toEqual({ provider: 'recall', reason: 'not_selected' });
  });
  it('auto without a user id fails closed', () => {
    expect(liveSttProviderFor(undefined, { LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_PERCENT: '100' })).toEqual({ provider: 'recall', reason: 'no_user' });
    expect(liveSttProviderFor({ id: '' }, { LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_PERCENT: '100' }).reason).toBe('no_user');
  });
  it('auto: percent 0 selects nobody, 100 selects everybody', () => {
    for (const u of [U1, U2, OWNER]) {
      expect(liveSttProviderFor(u, { LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_PERCENT: '0' }).provider).toBe('recall');
      expect(liveSttProviderFor(u, { LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_PERCENT: '100' })).toEqual({ provider: 'soniox', reason: 'percent' });
    }
  });
  it('auto: invalid percent values are 0, out-of-range values are clamped', () => {
    expect(parsePercent('abc')).toBe(0);
    expect(parsePercent('')).toBe(0);
    expect(parsePercent(undefined)).toBe(0);
    expect(parsePercent('-5')).toBe(0);
    expect(parsePercent('250')).toBe(100);
    expect(parsePercent('12.5')).toBe(12.5);
  });
});

describe('percentage rollout is stable and monotonic', () => {
  const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const sel = (pct: number) => new Set(ids.filter((id) => liveSttProviderFor(id, { LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_PERCENT: String(pct) }).provider === 'soniox'));
  it('the same user always gets the same bucket, case-insensitively', () => {
    expect(percentBucket(U1)).toBe(percentBucket(U1));
    expect(percentBucket(U1)).toBe(percentBucket(U1.toUpperCase()));
    expect(percentBucket(U1)).toBeGreaterThanOrEqual(0);
    expect(percentBucket(U1)).toBeLessThan(100);
  });
  it('widening the percentage only adds users (nobody is moved back to Recall)', () => {
    const a = sel(5), b = sel(25), c = sel(60);
    for (const id of a) expect(b.has(id)).toBe(true);
    for (const id of b) expect(c.has(id)).toBe(true);
  });
  it('selects roughly the requested share', () => {
    expect(sel(10).size / ids.length).toBeGreaterThan(0.07);
    expect(sel(10).size / ids.length).toBeLessThan(0.13);
    expect(sel(50).size / ids.length).toBeGreaterThan(0.45);
    expect(sel(50).size / ids.length).toBeLessThan(0.55);
  });
  it('the allowlist wins over the percentage', () => {
    const env = { LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_PERCENT: '0', LIVE_STT_SONIOX_USER_IDS: U2 };
    expect(liveSttProviderFor(U2, env).reason).toBe('allowlist');
  });
});

describe('planLiveStt with the new selection', () => {
  it('production defaults: recall, even with the soniox env fully configured and the shadow users unchanged', () => {
    expect(planLiveStt({ ...SOL }, U1)).toEqual({ provider: 'recall' });
    expect(planLiveStt({ ...SOL, LIVE_STT_SHADOW: 'true', LIVE_STT_SHADOW_USER_IDS: U1 }, U1)).toMatchObject({ provider: 'shadow' });
    expect(planLiveStt({ ...SOL, LIVE_STT_SHADOW: 'true', LIVE_STT_SHADOW_USER_IDS: U1 }, U2)).toEqual({ provider: 'recall' });
  });
  it('auto + allowlist = soniox primary; the shadow flag no longer applies to that user', () => {
    const p = planLiveStt({ ...SOL, LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_USER_IDS: U1, LIVE_STT_SHADOW: 'true', LIVE_STT_SHADOW_USER_IDS: U1 }, U1);
    expect(p).toMatchObject({ provider: 'soniox', selection: 'allowlist', standby: false });
  });
  it('a shadow user who is NOT selected stays a shadow user under auto', () => {
    const p = planLiveStt({ ...SOL, LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_USER_IDS: OWNER, LIVE_STT_SHADOW: 'true', LIVE_STT_SHADOW_USER_IDS: U1 }, U1);
    expect(p.provider).toBe('shadow');
  });
  it('hot standby needs the flag AND the allowlist stage AND fallback not off', () => {
    const base = { ...SOL, LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_USER_IDS: U1, LIVE_STT_SONIOX_PERCENT: '100', LIVE_STT_RECALL_HOT_STANDBY: 'true' };
    expect(planLiveStt(base, U1)).toMatchObject({ provider: 'soniox', standby: true });
    expect(planLiveStt(base, U2)).toMatchObject({ provider: 'soniox', standby: false, selection: 'percent' }); // percent stage: no standby cost
    expect(planLiveStt({ ...base, LIVE_STT_FALLBACK: 'off' }, U1)).toMatchObject({ standby: false });
    expect(planLiveStt({ ...base, LIVE_STT_RECALL_HOT_STANDBY: undefined }, U1)).toMatchObject({ standby: false });
    expect(planLiveStt({ ...base, LIVE_STT_PROVIDER: 'soniox' }, U1)).toMatchObject({ standby: false, selection: 'all' });
  });
  it('misconfigured soniox still yields a Recall transcript bot', () => {
    expect(planLiveStt({ LIVE_STT_PROVIDER: 'soniox' }, U1)).toEqual({ provider: 'recall', reason: 'misconfigured' });
  });
  it('isFallbackEnabled: on unless explicitly off', () => {
    expect(isFallbackEnabled(undefined)).toBe(true);
    for (const v of ['off', 'OFF', 'false', '0', 'no']) expect(isFallbackEnabled(v)).toBe(false);
    expect(isFallbackEnabled('on')).toBe(true);
  });
});
