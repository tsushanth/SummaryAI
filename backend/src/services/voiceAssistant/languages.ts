/**
 * Language support for the in-meeting voice assistant (behind MEETING_ASSISTANT_MULTILINGUAL, see docs/VOICE_ASSISTANT.md).
 *
 * A language is usable only when it has a language pack here (wake phrases, stop words, fixed spoken lines) AND a voice for the
 * non-English speech provider. English is always supported and keeps its own code paths (wake.ts, tts.ts) untouched.
 * No guessing: `decideLanguage` reports whether it is confident, and the session falls back to the English behaviour when it is not.
 */
import type { VoiceAssistantConfig } from './config.js';

export interface LanguageStrings {
  /** Said at once when a question is received ("Let me check."). */
  cue: string;
  apology: string;
  limit: string;
  /** Played when the bot joins. Names the wake phrase the way the speech provider should pronounce it. */
  intro: string;
  /** What the model must say when a non-owner asks about past meetings. */
  ownerOnly: string;
}

export interface LanguagePack {
  code: string;
  /** English name, used in the model prompt and in the "not supported" line. */
  name: string;
  script: 'cyrillic' | 'latin';
  /** Fixed lines. Machine-written: needs a native check before the language is announced (docs/VOICE_ASSISTANT.md). */
  strings: LanguageStrings;
  /** Regex source (u + i flags) that matches the START of an utterance: the wake phrase in this language. Group 1 = the rest. */
  wake: (extra: string[]) => RegExp;
  /** Regex (u + i flags) for stop words in this language. */
  stop: RegExp;
  /** Regex (u + i flags, global) that finds the wake phrase anywhere, to strip it from the bot's own speech. */
  wakeAnywhere: RegExp;
  /** Default voice id at the non-English speech provider. */
  defaultVoice: string;
  /** Rewrites digit runs into words (the provider cannot read digits for this language). */
  spellNumbers: (text: string) => string;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Russian
// ---------------------------------------------------------------------------------------------------------------------------------

const L = '\\p{L}';
/** JS \b does not know Cyrillic: these are the Unicode-aware word edges. */
const NOT_LETTER_BEFORE = `(?<!${L})`;
const NOT_LETTER_AFTER = `(?!${L})`;

/**
 * How the brand name sounds in Russian speech and how a Russian speech-to-text writes it. "митинг" alone is a real word (a rally), so
 * it is never a wake phrase on its own: the second word is required. "мит инг" (as it is often heard) may stand alone.
 */
const RU_MEETING = '(?:митинг|мийтинг|мидинг|митин|мит[\\s-]?инг|мит[\\s-]?ин|ми[\\s-]?тинг|митенг|мийтин)';
const RU_MIND = '(?:майнд|майнт|минд|мейнд|мэйнд|маинд|майн|мэнд|майнде)';
const RU_FILLER = '(?:(?:так|ну|эй|привет|слушай|слушайте|окей|ок|хорошо|итак|вот|алло|да)[\\s,]+){0,3}';

function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+');
}

function ruWake(extra: string[]): RegExp {
  const extras = extra.map(escapeLiteral);
  const phrase = [`${RU_MEETING}[\\s-]+${RU_MIND}`, 'мит[\\s-]?инг', ...extras].join('|');
  return new RegExp(`^\\s*${RU_FILLER}(?:${phrase})${NOT_LETTER_AFTER}[\\s,.:;!?-]*(.*)$`, 'isu');
}

/** Number words, Russian. Nominative; thousands feminine. Enough for the safety net, the model is asked to spell numbers itself. */
const RU_ONES_M = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const RU_TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const RU_HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function pluralRu(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

function below1000(n: number, feminine: boolean): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) out.push(RU_HUNDREDS[h]!);
  if (r >= 20) {
    out.push(RU_TENS[Math.floor(r / 10)]!);
    const u = r % 10;
    if (u) out.push(feminine && u === 1 ? 'одна' : feminine && u === 2 ? 'две' : RU_ONES_M[u]!);
  } else if (r > 0) {
    out.push(feminine && r === 1 ? 'одна' : feminine && r === 2 ? 'две' : RU_ONES_M[r]!);
  }
  return out;
}

export function ruNumberWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1e12) return '';
  n = Math.floor(n);
  if (n === 0) return RU_ONES_M[0]!;
  const parts: string[] = [];
  const groups: Array<[number, [string, string, string] | null, boolean]> = [
    [Math.floor(n / 1e9) % 1000, ['миллиард', 'миллиарда', 'миллиардов'], false],
    [Math.floor(n / 1e6) % 1000, ['миллион', 'миллиона', 'миллионов'], false],
    [Math.floor(n / 1e3) % 1000, ['тысяча', 'тысячи', 'тысяч'], true],
    [n % 1000, null, false],
  ];
  for (const [g, forms, fem] of groups) {
    if (!g) continue;
    parts.push(...below1000(g, fem));
    if (forms) parts.push(pluralRu(g, forms));
  }
  return parts.join(' ');
}

/** Neuter nominative ordinals 1..31, for dates ("двадцать третье ноября"). */
const RU_ORD_UNITS = ['', 'первое', 'второе', 'третье', 'четвёртое', 'пятое', 'шестое', 'седьмое', 'восьмое', 'девятое'];
const RU_ORD_TEENS = ['десятое', 'одиннадцатое', 'двенадцатое', 'тринадцатое', 'четырнадцатое', 'пятнадцатое', 'шестнадцатое', 'семнадцатое', 'восемнадцатое', 'девятнадцатое'];
function ruDayOrdinal(n: number): string {
  if (n < 1 || n > 31) return ruNumberWords(n);
  if (n < 10) return RU_ORD_UNITS[n]!;
  if (n < 20) return RU_ORD_TEENS[n - 10]!;
  if (n === 20) return 'двадцатое';
  if (n === 30) return 'тридцатое';
  return `${n < 30 ? 'двадцать' : 'тридцать'} ${RU_ORD_UNITS[n % 10]}`;
}

const RU_MONTHS = 'января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря';
const RU_CURRENCY: Record<string, [string, string, string]> = {
  '$': ['доллар', 'доллара', 'долларов'], '€': ['евро', 'евро', 'евро'], '₽': ['рубль', 'рубля', 'рублей'],
};

export function spellNumbersRu(text: string): string {
  let t = text.replace(/(\d)[   ](?=\d{3}(?!\d))/g, '$1'); // "1 200" -> "1200"
  // dates: "23 ноября"
  t = t.replace(new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${RU_MONTHS})`, 'giu'), (_m, d: string, mo: string) => `${ruDayOrdinal(Number(d))} ${mo}`);
  // time: "14:30"
  t = t.replace(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g, (_m, h: string, m: string) => `${ruNumberWords(Number(h))} ${m === '00' ? 'ноль ноль' : m.startsWith('0') ? `ноль ${ruNumberWords(Number(m))}` : ruNumberWords(Number(m))}`);
  // currency symbols before or after the number
  t = t.replace(/([$€₽])\s?(\d+)(?:[.,]\d+)?/g, (_m, c: string, n: string) => `${ruNumberWords(Number(n))} ${pluralRu(Number(n), RU_CURRENCY[c]!)}`);
  t = t.replace(/(\d+)(?:[.,]\d+)?\s?([$€₽])/g, (_m, n: string, c: string) => `${ruNumberWords(Number(n))} ${pluralRu(Number(n), RU_CURRENCY[c]!)}`);
  // percent
  t = t.replace(/(\d+)\s?%/g, (_m, n: string) => `${ruNumberWords(Number(n))} ${pluralRu(Number(n), ['процент', 'процента', 'процентов'])}`);
  // decimals: "3,5" -> "три запятая пять"
  t = t.replace(/(\d+)[.,](\d+)/g, (_m, a: string, b: string) => `${ruNumberWords(Number(a))} запятая ${ruNumberWords(Number(b))}`);
  // whatever is left: plain integers (very long digit runs, e.g. phone numbers, are read digit by digit)
  t = t.replace(/\d+/g, (d) => (d.length > 9 ? d.split('').map((c) => ruNumberWords(Number(c))).join(' ') : ruNumberWords(Number(d))));
  return t.replace(/\s+/g, ' ').trim();
}

const RU: LanguagePack = {
  code: 'ru',
  name: 'Russian',
  script: 'cyrillic',
  strings: {
    cue: 'Сейчас проверю.',
    apology: 'Извините, не получилось. Задайте вопрос ещё раз.',
    limit: 'Лимит вопросов на эту встречу исчерпан.',
    intro: 'Здравствуйте, это Митинг Майнд. Я записываю эту встречу. Чтобы задать мне вопрос, скажите «Митинг Майнд», а затем сам вопрос.',
    ownerOnly: 'Я могу искать прошлые встречи только для владельца аккаунта.',
  },
  wake: ruWake,
  stop: new RegExp(`${NOT_LETTER_BEFORE}(стоп|хватит|отмена|отменить|отставить|замолчи|замолчите|молчи|тихо|достаточно|не надо|не нужно|забудь|неважно|не важно)${NOT_LETTER_AFTER}`, 'iu'),
  wakeAnywhere: new RegExp(`${NOT_LETTER_BEFORE}(?:${RU_MEETING}[\\s-]+${RU_MIND}|мит[\\s-]?инг)${NOT_LETTER_AFTER}`, 'giu'),
  defaultVoice: 'aria',
  spellNumbers: spellNumbersRu,
};

const PACKS: Record<string, LanguagePack> = { ru: RU };

export function getLanguagePack(code: string | null | undefined): LanguagePack | null {
  return (code && PACKS[code.toLowerCase()]) || null;
}

/** Non-English languages that are fully usable right now: switched on in config, with a pack and a voice. */
export function supportedLanguages(cfg: Pick<VoiceAssistantConfig, 'languages' | 'languageVoices'>): string[] {
  return cfg.languages.filter((c) => !!getLanguagePack(c) && !!voiceFor(cfg, c));
}

export function voiceFor(cfg: Pick<VoiceAssistantConfig, 'languageVoices'>, code: string): string | null {
  return cfg.languageVoices[code] || getLanguagePack(code)?.defaultVoice || null;
}

export function isSupportedLanguage(cfg: Pick<VoiceAssistantConfig, 'languages' | 'languageVoices'>, code: string): boolean {
  return code === 'en' || supportedLanguages(cfg).includes(code);
}

/** The line spoken (in English) when a language outside the supported set is clearly being used. */
export function unsupportedLanguageText(cfg: Pick<VoiceAssistantConfig, 'languages' | 'languageVoices'>): string {
  const names = ['English', ...supportedLanguages(cfg).map((c) => getLanguagePack(c)!.name)];
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Sorry, I can only answer in ${list} for now.`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Which language is this question in?
// ---------------------------------------------------------------------------------------------------------------------------------

/** Codes written in Cyrillic, as speech-to-text language tags. */
const CYRILLIC_TAGS = new Set(['ru', 'uk', 'bg', 'be', 'sr', 'mk', 'kk', 'ky', 'mn', 'tg']);

export interface LangSignals {
  /** The question text (after the wake phrase). */
  text: string;
  /** Language tag the live transcript put on this segment. */
  tag?: string | null;
  /** Dominant tag of the last few finals of the meeting, or null when there is no clear one. */
  dominant?: string | null;
  /** Language chosen for the meeting in settings (null / 'auto' = none). */
  configured?: string | null;
}

export interface LangDecision {
  code: string;
  source: 'script' | 'tag' | 'dominant' | 'configured' | 'default';
  confident: boolean;
}

const cleanTag = (t: string | null | undefined): string | null => {
  const v = (t ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return /^[a-z]{2,3}$/.test(v) && v !== 'auto' ? v : null;
};

/**
 * Cyrillic text decides by itself (ы э ъ ё mean Russian, і ї є ґ mean Ukrainian) and is only trusted when it is long enough or a
 * language tag agrees. Latin text: a tag only counts when the meeting's dominant language agrees (a lone mis-tag on a short English
 * line must not produce a "language not supported" reply); with nothing to go on it is English, which is the current behaviour.
 */
export function decideLanguage(sig: LangSignals): LangDecision {
  const text = sig.text ?? '';
  const tag = cleanTag(sig.tag);
  const dominant = cleanTag(sig.dominant);
  const configured = cleanTag(sig.configured);
  const letters = text.match(/\p{L}/gu) ?? [];
  const cyr = (text.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const lat = (text.match(/\p{Script=Latin}/gu) ?? []).length;

  if (cyr >= 3 && cyr / Math.max(1, cyr + lat) >= 0.6) {
    if (/[іїєґІЇЄҐ]/u.test(text)) return { code: 'uk', source: 'script', confident: true };
    const hint = [tag, dominant, configured].find((c) => c && CYRILLIC_TAGS.has(c));
    if (hint) return { code: hint, source: hint === tag ? 'tag' : hint === dominant ? 'dominant' : 'configured', confident: true };
    if (/[ыэъёЫЭЪЁ]/u.test(text)) return { code: 'ru', source: 'script', confident: true };
    return { code: 'ru', source: 'script', confident: cyr >= 12 };
  }

  if (letters.length >= 3 && lat >= 3) {
    if (tag && !CYRILLIC_TAGS.has(tag) && (tag === 'en' || tag === dominant)) return { code: tag, source: 'tag', confident: true };
    if (dominant && !CYRILLIC_TAGS.has(dominant) && dominant !== 'en' && dominant === configured) return { code: dominant, source: 'dominant', confident: true };
    return { code: 'en', source: 'default', confident: true };
  }

  // Too little text to judge (a wake phrase and nothing else): lean on the meeting.
  const hint = tag ?? dominant ?? configured;
  if (hint) return { code: hint, source: tag ? 'tag' : dominant ? 'dominant' : 'configured', confident: !!(tag && tag === dominant) || !!(dominant && dominant === configured) };
  return { code: 'en', source: 'default', confident: true };
}

/** Rolling vote over the language tags of the last final segments of one meeting. */
export class LanguageTracker {
  private tags: string[] = [];
  constructor(private readonly window = 10, private readonly minSamples = 3, private readonly minShare = 0.6) {}

  observe(tag: string | null | undefined): void {
    const t = cleanTag(tag);
    if (!t) return;
    this.tags.push(t);
    if (this.tags.length > this.window) this.tags.shift();
  }

  /** The dominant tag, or null when there are too few samples or no clear majority. */
  dominant(): string | null {
    if (this.tags.length < this.minSamples) return null;
    const counts = new Map<string, number>();
    for (const t of this.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    return n / this.tags.length >= this.minShare ? best : null;
  }
}

/** True when the meeting language chosen in settings is a real language other than English. */
export function isNonEnglishConfigured(language: string | null | undefined): boolean {
  const c = cleanTag(language);
  return !!c && c !== 'en';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Text that will be spoken
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Last step before speech for a non-English answer: no digits reach a speech engine that cannot read them. Languages whose policy is
 * 'numbers' are left alone (the provider normalises). A language with a pack spells numbers as words; any other language without a
 * number rule has its digit runs removed (a missing number is better than a misread one).
 */
export function digitSafeText(text: string, lang: string, cfg: Pick<VoiceAssistantConfig, 'numberNormalize'>): string {
  if (lang === 'en' || cfg.numberNormalize[lang] === 'numbers') return text;
  const pack = getLanguagePack(lang);
  const spelled = pack ? pack.spellNumbers(text) : text;
  return spelled.replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Remove the wake phrase of this language from text the bot will speak (an echo of it would wake the bot). */
export function stripWakePhraseFor(text: string, lang: string): string {
  const pack = getLanguagePack(lang);
  return pack ? text.replace(pack.wakeAnywhere, 'я') : text;
}
