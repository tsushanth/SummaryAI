/**
 * Script-aware text helpers for the multilingual assistant (only used when MEETING_ASSISTANT_MULTILINGUAL is on).
 *
 * Each function first checks whether the text involves any non-Latin letters. If not, it calls the original English helper in
 * wake.ts unchanged, so English utterances behave exactly as before; only text that wake.ts cannot handle takes the new path.
 */
import type { VoiceAssistantConfig } from './config.js';
import { getLanguagePack, supportedLanguages, stripWakePhraseFor } from './languages.js';
import { detectWake, isEchoOf, isStopRequest, stripWakePhrase, wordCount, STOP_RE, type WakeMatch } from './wake.js';

/** Any letter that is not Latin (Cyrillic, Greek, ...). Typographic punctuation and digits do not count. */
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;
export const hasNonLatinLetters = (s: string): boolean => NON_LATIN_LETTER.test(s ?? '');

type WakeCfg = Pick<VoiceAssistantConfig, 'languages' | 'languageVoices' | 'extraWakePhrases'>;

const regexCache = new Map<string, RegExp>();
function wakeRegex(code: string, extra: string[]): RegExp | null {
  const pack = getLanguagePack(code);
  if (!pack) return null;
  const key = `${code}|${extra.join('\u0001')}`;
  let re = regexCache.get(key);
  if (!re) { re = pack.wake(extra); regexCache.set(key, re); }
  return re;
}

/**
 * The English wake phrase first (so "Meeting Mind, ..." works in any meeting and English text is decided by the original regex), then
 * the wake phrases of every supported language, tried only on text that has non-Latin letters.
 */
export function detectWakeMulti(text: string, cfg: WakeCfg): WakeMatch | null {
  const en = detectWake(text);
  if (en) return en;
  if (!hasNonLatinLetters(text)) return null;
  for (const code of supportedLanguages(cfg)) {
    const re = wakeRegex(code, cfg.extraWakePhrases[code] ?? []);
    const m = re?.exec(text ?? '');
    if (m) return { question: (m[1] ?? '').trim() };
  }
  return null;
}

/** Stop words of every supported language (non-Latin text only) plus the English ones. */
export function isStopWordMulti(text: string, cfg: WakeCfg): boolean {
  if (STOP_RE.test(text)) return true;
  if (!hasNonLatinLetters(text)) return false;
  return supportedLanguages(cfg).some((c) => getLanguagePack(c)!.stop.test(text));
}

/** A bare stop word (not a question that happens to contain one). */
export function isStopRequestMulti(text: string, cfg: WakeCfg): boolean {
  if (isStopRequest(text)) return true;
  if (!hasNonLatinLetters(text) || !isStopWordMulti(text, cfg)) return false;
  const w = detectWakeMulti(text, cfg);
  return wordCount(w ? w.question : text) < 4;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Echo guard
// ---------------------------------------------------------------------------------------------------------------------------------

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

const isCyrillic = (t: string): boolean => /\p{Script=Cyrillic}/u.test(t);

/** Lowercase, ё -> е, letters and digits only (any script), apostrophes kept. */
export function unicodeTokens(s: string): string[] {
  return (s ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
}

/** Latin spelling of a Cyrillic word, then consonant skeleton: "митинг", "meeting" and "mitting" all become "mtng". */
function skeleton(token: string): string {
  const latin = [...token].map((c) => TRANSLIT[c] ?? c).join('');
  const s = latin.replace(/(?!^)[aeiouy']/g, '').replace(/(.)\1+/g, '$1');
  return s;
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]!);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Do two words count as the same word heard twice? Exact; same script: shared 5-letter stem or a small edit distance; across scripts: same skeleton. */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = isCyrillic(a);
  const cb = isCyrillic(b);
  if (ca !== cb) {
    const sa = skeleton(a);
    const sb = skeleton(b);
    return sa.length >= 3 && sa === sb;
  }
  const min = Math.min(a.length, b.length);
  if (min < 5) return false; // short words (and numbers) must match exactly
  if (a.slice(0, 5) === b.slice(0, 5) && min >= 5 && Math.abs(a.length - b.length) <= 4) return true; // same stem, different ending
  return editDistance(a, b, a.length >= 9 && b.length >= 9 ? 2 : 1) <= (a.length >= 9 && b.length >= 9 ? 2 : 1);
}

/**
 * Echo guard that works across scripts. Pure Latin text on both sides goes to the original isEchoOf (identical behaviour for English).
 * Otherwise `heard` is an echo when at least `threshold` of its words (at least three) match a word of `spoken`.
 */
export function isEchoOfMulti(heard: string, spoken: string, threshold = 0.7): boolean {
  if (!hasNonLatinLetters(heard) && !hasNonLatinLetters(spoken)) return isEchoOf(heard, spoken, threshold);
  const h = unicodeTokens(heard);
  if (h.length < 3) return false;
  const s = [...new Set(unicodeTokens(spoken))];
  if (s.length === 0) return false;
  const sSet = new Set(s);
  const hit = h.filter((t) => sSet.has(t) || s.some((x) => tokensMatch(t, x))).length;
  return hit / h.length >= threshold;
}

/** English wake phrase plus the wake phrase of the answer's own language removed from text the bot will speak. */
export function stripWakePhraseMulti(text: string, lang: string): string {
  return stripWakePhraseFor(stripWakePhrase(text), lang);
}
