/**
 * Filler / backchannel filter for Soniox live segments (POST /internal/live-segments, Soniox-primary rows only).
 *
 * Why: in the 2026-11-07 shadow run 314 of 513 Soniox segments were a lone "Hmm." The live transcript, live insights, coaching and
 * the voice assistant all read those rows, so they are dropped before they are stored. Recall rows, shadow rows and the
 * final transcript are never touched, and dropped segments are counted (live_stt_filler_dropped) but never logged.
 *
 * A segment is dropped only when EVERY token is a filler for its language, or it contains no letter or digit at all ("...", "-").
 * Anything with a digit, any real word, and the usual short answers (yes, no, ok, okay, yeah, nope, sure, uh-huh, uh-uh) is kept.
 * A segment that mixes a filler with real words ("Hmm, yes.") is stored unchanged; the filter never rewrites text.
 *
 * Configuration (environment, all optional):
 *   LIVE_STT_FILLER_FILTER  off | false | 0 | no  turns the filter off (default on)
 *   LIVE_STT_FILLER_EXTRA   comma separated tokens treated as filler in every language
 *   LIVE_STT_FILLER_ALLOW   comma separated tokens that are never dropped (wins over every list)
 */

export interface FillerConfig {
  enabled: boolean;
  extra: Set<string>;
  allow: Set<string>;
}

/** Collapse runs of the same character ("uhhh" -> "uh", "ээ" -> "э") so elongations match without listing each one. */
function collapse(s: string): string {
  return s.replace(/(.)\1+/gu, '$1');
}

function norm(token: string): string {
  return token.normalize('NFKC').toLowerCase();
}

/**
 * Vocalisations with no lexical meaning in any supported language: hm, hmm, mm, mmm, mhm, mm-hmm, hmmm. (Pure m/h strings.)
 * "mhm" and "mm-hmm" are backchannel acknowledgements and are dropped on purpose; "uh-huh" and "uh-uh" are not (see PROTECTED).
 */
const UNIVERSAL = /^(?:h?m+|m+h+m*|mh?m+)$/u;

/** Per-language hesitation sounds (primary BCP-47 subtag). Deliberately excludes anything that is also a real answer or word in the
 *  language: ja うん/ええ/はい, zh 嗯, ko 응, th อืม, German "er"/"um", Spanish "este", Polish "no", Russian "ну". */
const BY_LANG: Record<string, string[]> = {
  en: ['uh', 'um', 'uhm', 'er', 'erm', 'err', 'ehm'],
  de: ['äh', 'ähm', 'äm', 'öh', 'ehm', 'ahm'],
  fr: ['euh', 'heu', 'hum', 'eum'],
  es: ['eh', 'em', 'emm', 'ehm', 'eeh', 'ehh'],
  it: ['eh', 'ehm', 'uhm', 'ehh'],
  pt: ['hum', 'ahn', 'ãh', 'ehm', 'eh'],
  nl: ['eh', 'ehm', 'uh', 'uhm', 'euh'],
  sv: ['öh', 'eh', 'äh', 'ehm'],
  da: ['øh', 'æh', 'eh', 'ehm'],
  no: ['øh', 'æh', 'eh', 'ehm'],
  fi: ['öö', 'ää', 'eee', 'ee'],
  pl: ['yyy', 'eee', 'yy', 'ee'],
  cs: ['ehm', 'ee', 'eee', 'ém'],
  sk: ['ehm', 'ee', 'eee', 'ém'],
  ro: ['ăă', 'ă', 'ee', 'eee'],
  hu: ['ööö', 'öö', 'ö', 'ehm'],
  hr: ['ee', 'eee', 'ehm'],
  bg: ['ъъ', 'ъ', 'ъм'],
  ru: ['э', 'ээ', 'эм', 'гм'],
  uk: ['е', 'ее', 'ем', 'гм'],
  el: ['εε', 'εεε', 'εμ', 'εμμ'],
  tr: ['ee', 'eee', 'ıı'],
  he: ['אה', 'אהה', 'אמ', 'אממ'],
  hi: ['हम्म', 'उम', 'उम्म', 'अम'],
  id: ['eh', 'em', 'emm', 'ee', 'eee'],
  ms: ['eh', 'em', 'emm', 'ee', 'eee'],
  vi: ['ừm', 'ờm', 'ưm'],
  ja: ['えー', 'えーと', 'えっと', 'あのー', 'あの', 'うーん', 'んー', 'ええと'],
  zh: ['呃', '额', '呃呃', '唔'],
  ko: ['음', '어', '으음', '어어'],
  th: ['เอ่อ'],
  ca: ['eh', 'ehm', 'em'],
  et: ['ee', 'eee', 'öö'],
  lt: ['ee', 'eee'],
  lv: ['ee', 'eee'],
};

/** Written-out short answers that carry meaning although they look like hesitations. Never dropped, whatever the lists say. */
const PROTECTED = /^(?:uh-uh|mm-mm|hm-hm|uh-huh)\W*$/iu;

const BY_LANG_COLLAPSED = new Map<string, Set<string>>(
  Object.entries(BY_LANG).map(([l, words]) => [l, new Set(words.map((w) => collapse(norm(w))))])
);

const OFF = new Set(['off', 'false', '0', 'no']);

function parseSet(v: string | undefined): Set<string> {
  return new Set((v ?? '').split(',').map((s) => collapse(norm(s.trim()))).filter(Boolean));
}

export function fillerConfigFrom(env: Record<string, string | undefined> = process.env): FillerConfig {
  return {
    enabled: !OFF.has((env.LIVE_STT_FILLER_FILTER ?? '').trim().toLowerCase()),
    extra: parseSet(env.LIVE_STT_FILLER_EXTRA),
    allow: parseSet(env.LIVE_STT_FILLER_ALLOW),
  };
}

export function primaryLanguage(lang: string | null | undefined): string {
  return (lang ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/** Tokens = runs of letters/digits/marks. Hyphens and apostrophes split ("mm-hmm" -> mm, hmm), which is what we want here. */
function tokens(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
}

/**
 * True when the segment text is only filler/backchannel (or only punctuation) for `language`.
 * `language` unknown (null/empty/unsupported) = English list plus the universal vocalisations.
 */
export function isFillerText(text: string, language?: string | null, cfg: FillerConfig = fillerConfigFrom()): boolean {
  if (!cfg.enabled) return false;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (PROTECTED.test(trimmed)) return false;
  const toks = tokens(trimmed);
  if (toks.length === 0) return true; // lone punctuation, "...", dashes
  const lang = primaryLanguage(language);
  const list = BY_LANG_COLLAPSED.get(lang) ?? BY_LANG_COLLAPSED.get('en')!;
  for (const t of toks) {
    if (/\p{N}/u.test(t)) return false; // numbers are never filler
    const c = collapse(t);
    if (cfg.allow.has(c)) return false;
    if (list.has(c) || cfg.extra.has(c) || UNIVERSAL.test(t)) continue;
    return false;
  }
  return true;
}

export interface FilterResult<T> {
  kept: T[];
  dropped: T[];
  /** Dropped count by language code ('und' = unknown), for the counter. */
  droppedByLang: Record<string, number>;
}

/** Split segments into kept and dropped. `fallbackLanguage` is the meeting's chosen language, used when a segment has none. */
export function filterFillerSegments<T extends { segment_text: string; language?: string | null }>(
  segments: T[],
  cfg: FillerConfig = fillerConfigFrom(),
  fallbackLanguage?: string | null
): FilterResult<T> {
  const kept: T[] = [];
  const dropped: T[] = [];
  const droppedByLang: Record<string, number> = {};
  for (const s of segments) {
    const lang = s.language || fallbackLanguage || null;
    if (isFillerText(s.segment_text, lang, cfg)) {
      dropped.push(s);
      const l = primaryLanguage(lang) || 'und';
      droppedByLang[l] = (droppedByLang[l] ?? 0) + 1;
    } else kept.push(s);
  }
  return { kept, dropped, droppedByLang };
}
