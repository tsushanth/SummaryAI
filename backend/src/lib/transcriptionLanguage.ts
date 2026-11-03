/**
 * Per-meeting transcription language: the allow-list, validation, and the mapping to each provider's request.
 * See backend/LIVE_STT.md ("Transcription language").
 *
 * The allow-list is the intersection of what Recall's `recallai_streaming` (accuracy mode) and Soniox (async and realtime) accept,
 * so one code is valid on every live path. Deepgram nova-2 (the final-transcript default) lacks two of them (he, hr): for those the
 * final transcript keeps `detect_language`. Sources, fetched 2026-11-03:
 *   Recall   https://docs.recall.ai/docs/recallai-transcription  (language_code list; low latency mode = `en` only; `auto` = accuracy only)
 *   Soniox   https://docs.soniox.com/stt/concepts/supported-languages (60 languages)
 *   Deepgram https://developers.deepgram.com/docs/models-languages-overview (nova-2)
 *
 * Stored value: NULL / absent = "auto". Only an explicit choice other than auto is persisted.
 */
import { z } from 'zod';

export const AUTO_LANGUAGE = 'auto';

export interface TranscriptionLanguage {
  /** Lowercase BCP-47 primary subtag, identical for Recall, Soniox and Deepgram. */
  code: string;
  /** English name. */
  name: string;
  /** Name in the language itself, for pickers. */
  native: string;
  /** Deepgram nova-2 accepts `language=<code>`. False = the final transcript keeps detect_language. */
  deepgramNova2: boolean;
}

const L = (code: string, name: string, native: string, deepgramNova2 = true): TranscriptionLanguage => ({ code, name, native, deepgramNova2 });

export const TRANSCRIPTION_LANGUAGES: readonly TranscriptionLanguage[] = [
  L('bg', 'Bulgarian', 'Български'),
  L('ca', 'Catalan', 'Català'),
  L('cs', 'Czech', 'Čeština'),
  L('da', 'Danish', 'Dansk'),
  L('de', 'German', 'Deutsch'),
  L('el', 'Greek', 'Ελληνικά'),
  L('en', 'English', 'English'),
  L('es', 'Spanish', 'Español'),
  L('et', 'Estonian', 'Eesti'),
  L('fi', 'Finnish', 'Suomi'),
  L('fr', 'French', 'Français'),
  L('he', 'Hebrew', 'עברית', false),
  L('hi', 'Hindi', 'हिन्दी'),
  L('hr', 'Croatian', 'Hrvatski', false),
  L('hu', 'Hungarian', 'Magyar'),
  L('id', 'Indonesian', 'Bahasa Indonesia'),
  L('it', 'Italian', 'Italiano'),
  L('ja', 'Japanese', '日本語'),
  L('ko', 'Korean', '한국어'),
  L('lt', 'Lithuanian', 'Lietuvių'),
  L('lv', 'Latvian', 'Latviešu'),
  L('ms', 'Malay', 'Bahasa Melayu'),
  L('nl', 'Dutch', 'Nederlands'),
  L('no', 'Norwegian', 'Norsk'),
  L('pl', 'Polish', 'Polski'),
  L('pt', 'Portuguese', 'Português'),
  L('ro', 'Romanian', 'Română'),
  L('ru', 'Russian', 'Русский'),
  L('sk', 'Slovak', 'Slovenčina'),
  L('sv', 'Swedish', 'Svenska'),
  L('th', 'Thai', 'ไทย'),
  L('tr', 'Turkish', 'Türkçe'),
  L('uk', 'Ukrainian', 'Українська'),
  L('vi', 'Vietnamese', 'Tiếng Việt'),
  L('zh', 'Chinese', '中文'),
];

const BY_CODE = new Map(TRANSCRIPTION_LANGUAGES.map((l) => [l.code, l]));

/** Legacy / alternative primary subtags clients still send (old Java/Android locale codes, Norwegian Bokmal/Nynorsk). */
const ALIASES: Record<string, string> = { iw: 'he', in: 'id', nb: 'no', nn: 'no' };

/** 'auto' | an allow-listed code, or null when the input is not acceptable. Region/script subtags are dropped (fr-CA -> fr). */
export function normalizeTranscriptionLanguage(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  if (!v || v.length > 16) return null;
  if (v === AUTO_LANGUAGE) return AUTO_LANGUAGE;
  const m = /^([a-z]{2,3})([-_][a-z0-9]{2,8})*$/.exec(v);
  if (!m) return null;
  const primary = ALIASES[m[1]!] ?? m[1]!;
  return BY_CODE.has(primary) ? primary : null;
}

/** Zod schema for request bodies: parses to the normalized value, rejects unknown codes. */
export const TranscriptionLanguageSchema = z.string().transform((v, ctx) => {
  const n = normalizeTranscriptionLanguage(v);
  if (n === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Unsupported transcription language' });
    return z.NEVER;
  }
  return n;
});

/** A value read back from the database (or a profile preference): anything unknown is treated as auto. */
export function storedLanguageOrAuto(v: unknown): string {
  return normalizeTranscriptionLanguage(v) ?? AUTO_LANGUAGE;
}

/** Value to persist for a choice: `auto` is stored as NULL (the column default), so default inserts never change. */
export function languageToStore(choice: string | null | undefined): string | null {
  const n = normalizeTranscriptionLanguage(choice ?? undefined);
  return n && n !== AUTO_LANGUAGE ? n : null;
}

export interface RecallTranscriptProviderBlock {
  mode: 'prioritize_low_latency' | 'prioritize_accuracy';
  language_code: string;
}

/**
 * The `recording_config.transcript.provider.recallai_streaming` object for one bot.
 *
 * Recall: `prioritize_low_latency` supports `en` ONLY ("Do not set language_code to auto or any non-English language code"), and
 * every other language_code (and `auto`) needs `prioritize_accuracy`, whose realtime events arrive 3-10 minutes late. So:
 *  - nothing chosen / auto / en  -> exactly the pre-existing block (en; low latency when realtime is on). `auto` does NOT silently
 *    switch live captions to the delayed mode; set `autoDetect` (env RECALL_AUTO_LANGUAGE=detect) to opt in to Recall detection.
 *  - any other allow-listed code -> accuracy mode with that language_code (live captions are minutes late; final transcript is unaffected).
 */
export function recallTranscriptProvider(
  language: string | null | undefined,
  enableRealtime: boolean,
  opts: { autoDetect?: boolean } = {}
): RecallTranscriptProviderBlock {
  const n = language ? normalizeTranscriptionLanguage(language) : null;
  if (n === AUTO_LANGUAGE || n === null) {
    if (opts.autoDetect) return { mode: 'prioritize_accuracy', language_code: AUTO_LANGUAGE };
    return { mode: enableRealtime ? 'prioritize_low_latency' : 'prioritize_accuracy', language_code: 'en' };
  }
  if (n === 'en') return { mode: enableRealtime ? 'prioritize_low_latency' : 'prioritize_accuracy', language_code: 'en' };
  return { mode: 'prioritize_accuracy', language_code: n };
}

/** `language=` value for Deepgram prerecorded, or null = keep `detect_language=true`. */
export function deepgramLanguageParam(language: string | null | undefined): string | null {
  const n = language ? normalizeTranscriptionLanguage(language) : null;
  if (!n || n === AUTO_LANGUAGE) return null;
  return BY_CODE.get(n)?.deepgramNova2 ? n : null;
}

/** Soniox `language_hints` (async and realtime). Empty for auto. */
export function sonioxLanguageHints(language: string | null | undefined): string[] {
  const n = language ? normalizeTranscriptionLanguage(language) : null;
  return n && n !== AUTO_LANGUAGE ? [n] : [];
}

// --- best-effort language of a stitched live transcript (only used when the live provider did not record one) ---------------------

const SCRIPTS: Array<[string, RegExp]> = [
  ['ja', /[぀-ヿ]/g],
  ['ko', /[가-힯ᄀ-ᇿ]/g],
  ['th', /[฀-๿]/g],
  ['he', /[֐-׿]/g],
  ['ar', /[؀-ۿ]/g],
  ['hi', /[ऀ-ॿ]/g],
  ['el', /[Ͱ-Ͽ]/g],
  ['ru', /[Ѐ-ӿ]/g],
  ['zh', /[一-鿿]/g],
];

const STOP: Record<string, string[]> = {
  en: 'the and is to of that we have it for with this are you be on will not'.split(' '),
  es: 'el los las que y en un una es por para con no se como porque vamos tenemos del'.split(' '),
  fr: 'le les des et est que pour une nous dans pas qui vous avons sur ce je'.split(' '),
  de: 'der die das und ist nicht wir ein eine zu mit den auf für über müssen werden ich'.split(' '),
  pt: 'os uma para com não você está como são então muito'.split(' '),
  it: 'il gli che per con non sono questo della abbiamo anche'.split(' '),
  nl: 'het een van ik dat niet voor met zijn maar ook'.split(' '),
};

/** Dominant language of `text`: by script for non-Latin scripts, by stop-word count for common Latin-script languages, else 'en'. */
export function languageFromText(text: string): string {
  const sample = (text ?? '').slice(0, 20_000);
  if (sample.trim().length < 12) return 'en';
  const letters = sample.replace(/[\s\d\p{P}]/gu, '').length || 1;
  let best: [string, number] = ['', 0];
  for (const [code, re] of SCRIPTS) {
    const n = (sample.match(re) ?? []).length;
    if (n > best[1]) best = [code, n];
  }
  if (best[1] / letters > 0.3) {
    if (best[0] === 'ru' && /[іїєґ]/i.test(sample) && !/[ыэъ]/i.test(sample)) return 'uk';
    return best[0];
  }
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  let top: [string, number] = ['en', 0];
  for (const [code, list] of Object.entries(STOP)) {
    const set = new Set(list);
    let n = 0;
    for (const w of words) if (set.has(w)) n++;
    if (n > top[1]) top = [code, n];
  }
  return top[1] >= 2 ? top[0] : 'en';
}

/**
 * `transcripts.language` for a transcript stitched from live segments (stuck-recording recovery).
 *  - an explicit language of the run wins;
 *  - the Recall transcript with nothing chosen really was English (low latency mode) unless Recall detection is on;
 *  - otherwise (Soniox auto, Recall detection) detect from the text instead of hard-coding 'en'.
 */
export function stitchedLanguage(opts: {
  explicit: string | null | undefined;
  provider: string | null | undefined;
  fullText: string;
  recallAutoDetect: boolean;
}): string {
  const chosen = opts.explicit ? normalizeTranscriptionLanguage(opts.explicit) : null;
  if (chosen && chosen !== AUTO_LANGUAGE) return chosen;
  if (opts.provider === 'soniox' || opts.recallAutoDetect) return languageFromText(opts.fullText);
  return 'en';
}
