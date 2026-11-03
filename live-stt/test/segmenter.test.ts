import { describe, expect, it } from 'vitest';
import { Segmenter, type AbsToken } from '../src/segmenter.js';

let t = 0;
const tok = (text: string, speaker = '1', gapBefore = 0, dur = 200, epoch = 0): AbsToken => {
  t += gapBefore;
  const s = t;
  t += dur;
  return { text, startMs: s, endMs: t, speaker, epoch };
};
const reset = () => { t = 0; };

describe('Segmenter', () => {
  it('groups sub-word tokens into words and joins text', () => {
    reset();
    const s = new Segmenter();
    s.push([tok('Hel'), tok('lo'), tok(' wor'), tok('ld')]);
    const [seg] = s.flush();
    expect(seg!.text).toBe('Hello world');
    expect(seg!.words.map((w) => w.text)).toEqual(['Hello', 'world']);
    expect(seg!.words[0]).toMatchObject({ startMs: 0, endMs: 400 });
    expect(seg!.startMs).toBe(0);
    expect(seg!.endMs).toBe(800);
  });
  it('closes the segment on speaker change', () => {
    reset();
    const s = new Segmenter();
    const out = s.push([tok('Hi', '1'), tok(' there', '1'), tok(' Hello', '2')]);
    expect(out.map((x) => x.text)).toEqual(['Hi there']);
    expect(out[0]!.speaker).toBe('1');
    expect(s.flush().map((x) => x.text)).toEqual(['Hello']);
  });
  it('closes on a silence gap greater than gapMs', () => {
    reset();
    const s = new Segmenter({ gapMs: 1200 });
    const out = s.push([tok('one'), tok(' two'), tok(' three', '1', 1500)]);
    expect(out.map((x) => x.text)).toEqual(['one two']);
    expect(s.flush().map((x) => x.text)).toEqual(['three']);
  });
  it('does not close on a small gap', () => {
    reset();
    const s = new Segmenter({ gapMs: 1200 });
    expect(s.push([tok('one'), tok(' two', '1', 1000)])).toEqual([]);
  });
  it('closes after sentence-ending punctuation once the segment has enough words', () => {
    reset();
    const s = new Segmenter({ minWordsForSentenceBreak: 3 });
    const out = s.push([tok('Yes'), tok('.'), tok(' We'), tok(' should'), tok(' ship'), tok(' it'), tok('.'), tok(' Next')]);
    // "Yes." is too short to break on (1 word): it continues into the next sentence
    expect(out.map((x) => x.text)).toEqual(['Yes. We should ship it.']);
    expect(s.flush().map((x) => x.text)).toEqual(['Next']);
  });
  it('closes when a segment exceeds maxSegmentMs', () => {
    reset();
    const s = new Segmenter({ maxSegmentMs: 3000, minWordsForSentenceBreak: 99 });
    const toks = Array.from({ length: 30 }, (_, i) => tok(` w${i}`));
    const out = s.push(toks);
    expect(out.length).toBeGreaterThanOrEqual(1);
    for (const seg of out) expect(seg.endMs - seg.startMs).toBeLessThanOrEqual(3400);
    const total = out.concat(s.flush()).map((x) => x.words.length).reduce((a, b) => a + b, 0);
    expect(total).toBe(30);
  });
  it('splits when the epoch changes even if the label is the same', () => {
    reset();
    const s = new Segmenter();
    const out = s.push([tok('a', '1', 0, 200, 0), tok(' b', '1', 0, 200, 1)]);
    expect(out.map((x) => x.text)).toEqual(['a']);
    expect(out[0]!.epoch).toBe(0);
    expect(s.flush()[0]!.epoch).toBe(1);
  });
  it('closes the open segment on an <end> control token and ignores <fin>', () => {
    reset();
    const s = new Segmenter({ minWordsForSentenceBreak: 99 });
    const out = s.push([tok('Hello'), tok(' there'), { text: '', startMs: 0, endMs: 0, epoch: 0, control: 'end' }, tok(' Next')]);
    expect(out.map((x) => x.text)).toEqual(['Hello there']);
    expect(s.push([{ text: '', startMs: 0, endMs: 0, epoch: 0, control: 'fin' }])).toEqual([]);
    expect(s.flush().map((x) => x.text)).toEqual(['Next']);
  });
  it('carries the dominant language and flush on empty is a no-op', () => {
    reset();
    const s = new Segmenter();
    s.push([{ ...tok('Hola'), language: 'es' }, { ...tok(' amigo'), language: 'es' }]);
    expect(s.flush()[0]!.language).toBe('es');
    expect(s.flush()).toEqual([]);
  });
  it('has bounded state: a run of 100k tokens never holds more than maxSegmentMs of words', () => {
    reset();
    const s = new Segmenter({ maxSegmentMs: 15_000, minWordsForSentenceBreak: 99 });
    let emitted = 0;
    for (let i = 0; i < 100_000; i++) emitted += s.push([tok(` w${i}`)]).length;
    expect(s.pendingWords()).toBeLessThanOrEqual(80);
    expect(emitted).toBeGreaterThan(1000);
  });
});
