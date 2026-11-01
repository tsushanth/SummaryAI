import { describe, it, expect } from 'vitest';

const { isRevenueCatAuthorized } = await import('../src/lib/webhookAuth.js');
const { findMissingConfig, FEATURE_SECRETS } = await import('../src/lib/startupConfig.js');

describe('RevenueCat webhook auth', () => {
  it('fails closed when no secret is configured', () => {
    expect(isRevenueCatAuthorized(undefined, undefined)).toBe(false);
    expect(isRevenueCatAuthorized('anything', undefined)).toBe(false);
    expect(isRevenueCatAuthorized('anything', '')).toBe(false);
  });
  it('accepts only the exact header', () => {
    expect(isRevenueCatAuthorized('Bearer abc', 'Bearer abc')).toBe(true);
    expect(isRevenueCatAuthorized('Bearer abd', 'Bearer abc')).toBe(false);
    expect(isRevenueCatAuthorized('Bearer abcd', 'Bearer abc')).toBe(false);
    expect(isRevenueCatAuthorized(undefined, 'Bearer abc')).toBe(false);
  });
  it('the unused RevenueCat secret no longer triggers the startup alert', () => {
    expect(FEATURE_SECRETS as readonly string[]).not.toContain('REVENUECAT_WEBHOOK_AUTH_HEADER');
    const env: any = {};
    for (const n of FEATURE_SECRETS) env[n] = 'x';
    expect(findMissingConfig(env).features).toEqual([]);
  });
});
