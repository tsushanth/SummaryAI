/**
 * Normalized word error rate between two transcripts, for shadow comparison only. Not a quality score against ground
 * truth: with the primary provider as the reference it measures DISAGREEMENT between providers.
 * Normalisation: NFKC, lowercase, punctuation and apostrophes dropped, hyphens/underscores as spaces, one token per
 * character for unspaced scripts (CJK, Thai). Numbers are not normalised ("10" vs "ten" counts as an error).
 */
const UNSPACED = /[぀-ヿ㐀-䶿一-鿿豈-﫿฀-๿]/u;
const UNSPACED_G = new RegExp(UNSPACED.source, 'gu');

export function normalizeForWer(text: string): string[] {
  const t = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(UNSPACED_G, (c) => ` ${c} `);
  return t.split(/\s+/).filter((w) => w.length > 0);
}

/** Default cap on the DP table (about 1 s of synchronous work). Above it the comparison is skipped (null). */
export const DEFAULT_MAX_CELLS = 2.5e8;

export function normalizedWer(reference: string, hypothesis: string, opts: { maxCells?: number } = {}): number | null {
  const ref = normalizeForWer(reference);
  const hyp = normalizeForWer(hypothesis);
  if (ref.length === 0 && hyp.length === 0) return 0;
  if (ref.length === 0 || hyp.length === 0) return 1;
  if (ref.length === hyp.length && ref.every((w, i) => w === hyp[i])) return 0;
  if (ref.length * hyp.length > (opts.maxCells ?? DEFAULT_MAX_CELLS)) return null;

  let prev = new Array<number>(hyp.length + 1);
  let cur = new Array<number>(hyp.length + 1);
  for (let j = 0; j <= hyp.length; j++) prev[j] = j;
  for (let i = 1; i <= ref.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= hyp.length; j++) {
      const sub = prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[hyp.length] / ref.length;
}
