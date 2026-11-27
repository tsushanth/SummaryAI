/**
 * Output language for AI-written text (summaries, Q&A answers, live insights, coaching).
 *
 * Clients send a BCP-47 tag (Android: the user's preference, else the app locale; iOS: the picker). Everything that
 * prompts a model for user-facing text maps it to a language name here and appends one shared instruction, so the
 * behaviour is identical on every surface. No language (null, '', 'auto', or a code we do not know) means "no
 * instruction", which is exactly the behaviour old clients get.
 */

/** Language subtag (lower case) -> English language name used in prompts. Covers every locale the Android app ships. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Simplified Chinese', // bare 'zh' (old clients) stays Simplified; Traditional variants are resolved in chineseVariantName
  hi: 'Hindi',
  ar: 'Arabic',
  ru: 'Russian',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  id: 'Indonesian',
  in: 'Indonesian', // legacy Java/Android code for Indonesian
  ms: 'Malay',
  th: 'Thai',
  tl: 'Tagalog',
  fil: 'Filipino', // Android's newer Filipino locale
  vi: 'Vietnamese',
  cs: 'Czech',
  el: 'Greek',
  fi: 'Finnish',
  hu: 'Hungarian',
  ro: 'Romanian',
  sv: 'Swedish',
  uk: 'Ukrainian',
  // The rest of the transcription languages (lib/transcriptionLanguage.ts): a summary follows the spoken language.
  bg: 'Bulgarian',
  ca: 'Catalan',
  da: 'Danish',
  et: 'Estonian',
  he: 'Hebrew',
  iw: 'Hebrew', // legacy Java/Android code
  hr: 'Croatian',
  lt: 'Lithuanian',
  lv: 'Latvian',
  no: 'Norwegian',
  nb: 'Norwegian',
  nn: 'Norwegian',
  sk: 'Slovak',
};

/** Chinese written in Traditional characters, by market (wording differs: Taiwan 軟體/網路, Hong Kong 軟件/網絡). */
const TRADITIONAL_CHINESE_NAMES: Record<'tw' | 'hk', string> = {
  tw: 'Traditional Chinese (Taiwan)',
  hk: 'Traditional Chinese (Hong Kong)',
};

/**
 * Name for a Chinese tag, from its script and region subtags: zh-TW / zh-Hant / zh-Hant-TW => Taiwan, zh-HK / zh-MO /
 * zh-Hant-HK / zh-Hant-MO => Hong Kong, everything else (zh, zh-CN, zh-SG, zh-Hans, ...) => Simplified.
 */
function chineseVariantName(subtags: string[]): string {
  const script = subtags.find((t) => t.length === 4);
  const region = subtags.find((t) => t.length === 2);
  const traditional = script === 'hant' || (script === undefined && (region === 'tw' || region === 'hk' || region === 'mo'));
  if (!traditional) return LANGUAGE_NAMES.zh;
  return region === 'hk' || region === 'mo' ? TRADITIONAL_CHINESE_NAMES.hk : TRADITIONAL_CHINESE_NAMES.tw;
}

/**
 * Map a BCP-47 language code (or "es_MX") to a human-readable language name for prompting.
 * Returns null for unrecognized / "auto" / empty values.
 */
export function languageNameForCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = code.trim().toLowerCase();
  if (!normalized || normalized === 'auto') return null;
  const subtags = normalized.split(/[-_]/);
  const base = subtags[0];
  // Own keys only: a plain object lookup would resolve 'constructor' / '__proto__' to Object.prototype members.
  if (!base || !Object.hasOwn(LANGUAGE_NAMES, base)) return null;
  return base === 'zh' ? chineseVariantName(subtags.slice(1)) : LANGUAGE_NAMES[base];
}

/** The first usable output language: explicit request value, then the recording's stored one. null = leave the model default. */
export function pickOutputLanguage(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    if (languageNameForCode(c)) return c as string;
  }
  return null;
}

/**
 * The language a summary is written in: the one chosen for the recording, else the language transcription detected
 * ("same language as the recording"). A document has no detected language (it is stored as 'en' whatever it says), so
 * null: the summary prompt then asks the model to follow the text.
 */
export function summaryLanguageCode(
  recording: { output_language?: string | null; content_type?: string | null; file_path?: string | null },
  detectedLanguage: string | null | undefined
): string | null {
  const isDocument = recording.content_type === 'application/pdf' || !!recording.file_path?.endsWith('.pdf');
  return pickOutputLanguage(recording.output_language, isDocument ? null : detectedLanguage);
}

/**
 * Sentence appended to a system prompt so free-text output is written in the user's language. Returns '' when there is
 * no usable language, so callers can append it unconditionally and old-client prompts stay byte-identical.
 * Machine-readable parts (JSON keys, enum values such as "now" or "verified", ids) must stay as the prompt specifies.
 */
export function languageInstruction(code: string | null | undefined): string {
  const name = languageNameForCode(code);
  if (!name) return '';
  return `\n\nWrite all user-facing text in ${name}, even if the transcript is in another language. Keep JSON keys, enum values and ids exactly as specified above, and quote the transcript verbatim in its original language.`;
}
