import { describe, it, expect } from 'vitest';
import { normalizeForWer, normalizedWer } from '../src/services/stt/wer.js';

describe('normalizeForWer', () => {
  it('lowercases, strips punctuation and apostrophes, collapses whitespace', () => {
    expect(normalizeForWer("Hello,  World! It's 10-20 O'Clock.")).toEqual(['hello', 'world', 'its', '10', '20', 'oclock']);
  });
  it('keeps accents (they change the word) but unifies unicode forms', () => {
    expect(normalizeForWer('Más café')).toEqual(['más', 'café']);
    expect(normalizeForWer('Café')).toEqual(normalizeForWer('Café'));
  });
  it('tokenises unspaced scripts per character', () => {
    expect(normalizeForWer('你好 world')).toEqual(['你', '好', 'world']);
  });
});

describe('normalizedWer', () => {
  it('is 0 for identical text modulo case and punctuation', () => {
    expect(normalizedWer('The quick brown fox.', 'the quick, brown fox')).toBe(0);
  });
  it('counts one substitution in ten words as 0.1', () => {
    expect(normalizedWer('a b c d e f g h i j', 'a b c d e f g h i x')).toBeCloseTo(0.1, 10);
  });
  it('counts insertions and deletions', () => {
    expect(normalizedWer('a b c d', 'a b c')).toBeCloseTo(0.25, 10);
    expect(normalizedWer('a b c d', 'a b x c d')).toBeCloseTo(0.25, 10);
  });
  it('both empty = 0; hypothesis empty = 1; reference empty with hypothesis = 1', () => {
    expect(normalizedWer('', '')).toBe(0);
    expect(normalizedWer('a b', '')).toBe(1);
    expect(normalizedWer('', 'a b')).toBe(1);
  });
  it('returns null (skipped) rather than blocking the event loop when the problem is too large', () => {
    const big = Array.from({ length: 20000 }, (_, i) => `w${i}`).join(' ');
    const other = big + ' extra';
    expect(normalizedWer(big, other, { maxCells: 1e6 })).toBeNull();
    expect(normalizedWer(big, big)).toBe(0); // identical input short-circuits
  });
});
