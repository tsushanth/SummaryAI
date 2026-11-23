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
  zh: 'Chinese',
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
};

/**
 * Map a BCP-47 language code (or "es_MX") to a human-readable language name for prompting.
 * Returns null for unrecognized / "auto" / empty values.
 */
export function languageNameForCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = code.trim().toLowerCase();
  if (!normalized || normalized === 'auto') return null;
  const base = normalized.split(/[-_]/)[0];
  return base ? (LANGUAGE_NAMES[base] ?? null) : null;
}

/** The first usable output language: explicit request value, then the recording's stored one. null = leave the model default. */
export function pickOutputLanguage(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    if (languageNameForCode(c)) return c as string;
  }
  return null;
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
