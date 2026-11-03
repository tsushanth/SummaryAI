/**
 * Turns the stream of FINAL tokens into transcript segments (the unit stored in live_transcripts).
 * Soniox tokens are sub-word pieces: a token whose text starts with whitespace begins a new word, otherwise it continues the
 * previous word (and punctuation tokens attach to the previous word). A segment closes on
 *   - a speaker (or stream epoch) change,
 *   - a silence gap longer than gapMs between tokens,
 *   - sentence-ending punctuation once the segment has minWordsForSentenceBreak words (keeps live rows sentence-sized, like Recall's),
 *   - maxSegmentMs of speech (a hard bound on both latency and memory).
 * Time-based flushing of the last open segment (nobody speaks any more) is the caller's job: flush().
 */

export interface AbsToken {
  text: string;
  /** Absolute ms on the Recall recording clock. */
  startMs: number;
  endMs: number;
  speaker?: string | undefined;
  /** Stream generation. Soniox speaker labels are only meaningful within one epoch. */
  epoch: number;
  language?: string | undefined;
  /** Endpoint/finalize marker: closes the open segment, carries no text. */
  control?: 'end' | 'fin' | undefined;
}

export interface SegWord { text: string; startMs: number; endMs: number }

export interface RawSegment {
  text: string;
  startMs: number;
  endMs: number;
  speaker: string;
  epoch: number;
  language?: string;
  words: SegWord[];
}

export interface SegmenterOptions {
  gapMs?: number;
  maxSegmentMs?: number;
  minWordsForSentenceBreak?: number;
}

const SENTENCE_END = /[.?!。！？]$/;

export class Segmenter {
  private readonly gapMs: number;
  private readonly maxSegmentMs: number;
  private readonly minWords: number;
  private words: SegWord[] = [];
  private speaker = '';
  private epoch = 0;
  private langCounts = new Map<string, number>();
  private lastEnd = 0;

  constructor(o: SegmenterOptions = {}) {
    this.gapMs = o.gapMs ?? 1200;
    this.maxSegmentMs = o.maxSegmentMs ?? 15_000;
    this.minWords = o.minWordsForSentenceBreak ?? 3;
  }

  pendingWords(): number {
    return this.words.length;
  }

  push(tokens: AbsToken[]): RawSegment[] {
    const out: RawSegment[] = [];
    for (const t of tokens) {
      if (t.control) {
        if (t.control === 'end') this.close(out);
        continue;
      }
      const spk = t.speaker ?? '?';
      if (this.words.length > 0) {
        const speakerChanged = spk !== this.speaker || t.epoch !== this.epoch;
        const gap = t.startMs - this.lastEnd > this.gapMs;
        const tooLong = t.endMs - this.words[0]!.startMs > this.maxSegmentMs;
        if (speakerChanged || gap || tooLong) this.close(out);
      }
      if (this.words.length === 0) {
        this.speaker = spk;
        this.epoch = t.epoch;
      }
      const startsWord = /^\s/.test(t.text) || this.words.length === 0;
      const clean = t.text.replace(/^\s+/, '');
      if (startsWord) this.words.push({ text: clean, startMs: t.startMs, endMs: t.endMs });
      else {
        const w = this.words[this.words.length - 1]!;
        w.text += clean;
        w.endMs = Math.max(w.endMs, t.endMs);
      }
      this.lastEnd = Math.max(this.lastEnd, t.endMs);
      if (t.language) this.langCounts.set(t.language, (this.langCounts.get(t.language) ?? 0) + 1);
      if (SENTENCE_END.test(clean) && this.words.length >= this.minWords) this.close(out);
    }
    return out;
  }

  flush(): RawSegment[] {
    const out: RawSegment[] = [];
    this.close(out);
    return out;
  }

  private close(out: RawSegment[]): void {
    if (this.words.length === 0) return;
    let lang: string | undefined;
    let best = 0;
    for (const [l, n] of this.langCounts) if (n > best) { best = n; lang = l; }
    const seg: RawSegment = {
      text: this.words.map((w) => w.text).join(' '),
      startMs: this.words[0]!.startMs,
      endMs: this.words[this.words.length - 1]!.endMs,
      speaker: this.speaker,
      epoch: this.epoch,
      words: this.words,
    };
    if (lang) seg.language = lang;
    out.push(seg);
    this.words = [];
    this.langCounts = new Map();
  }
}
