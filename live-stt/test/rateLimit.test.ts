import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from '../src/rateLimit.js';

describe('SlidingWindowLimiter', () => {
  it('allows up to max hits per window per key, then denies', () => {
    let now = 0;
    const l = new SlidingWindowLimiter({ max: 3, windowMs: 1000, now: () => now });
    expect([l.hit('a'), l.hit('a'), l.hit('a'), l.hit('a')]).toEqual([true, true, true, false]);
    expect(l.hit('b')).toBe(true);
  });
  it('recovers after the window slides', () => {
    let now = 0;
    const l = new SlidingWindowLimiter({ max: 2, windowMs: 1000, now: () => now });
    l.hit('a'); l.hit('a');
    expect(l.hit('a')).toBe(false);
    now = 1001;
    expect(l.hit('a')).toBe(true);
  });
  it('count/isLimited do not record', () => {
    let now = 0;
    const l = new SlidingWindowLimiter({ max: 2, windowMs: 1000, now: () => now });
    l.hit('a'); l.hit('a');
    expect(l.count('a')).toBe(2);
    expect(l.isLimited('a')).toBe(true);
    expect(l.count('a')).toBe(2);
  });
  it('bounds the number of tracked keys', () => {
    let now = 0;
    const l = new SlidingWindowLimiter({ max: 5, windowMs: 1000, maxKeys: 100, now: () => now });
    for (let i = 0; i < 1000; i++) { now += 1; l.hit(`ip-${i}`); }
    expect(l.size()).toBeLessThanOrEqual(100);
  });
});
