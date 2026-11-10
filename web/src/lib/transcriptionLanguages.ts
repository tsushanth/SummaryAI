/**
 * Per-meeting transcription language: the picker list and the wording around it.
 * The list MUST equal backend/src/lib/transcriptionLanguage.ts (languages both Recall and Soniox support);
 * scripts/transcriptionLanguages.test.mjs compares the two files. No runtime imports.
 */
export const AUTO_LANGUAGE = 'auto';

export interface TranscriptionLanguage {
  code: string;
  name: string;
  native: string;
}

export const TRANSCRIPTION_LANGUAGES: readonly TranscriptionLanguage[] = [
  { code: 'bg', name: 'Bulgarian', native: 'Български' },
  { code: 'ca', name: 'Catalan', native: 'Català' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'et', name: 'Estonian', native: 'Eesti' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'he', name: 'Hebrew', native: 'עברית' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
  { code: 'lv', name: 'Latvian', native: 'Latviešu' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'zh', name: 'Chinese', native: '中文' },
];

function label(l: TranscriptionLanguage): string {
  return l.native === l.name ? l.name : `${l.native} (${l.name})`;
}

/** Auto-detect first, then every language by English name. */
export function languageOptions(): { value: string; label: string }[] {
  const sorted = [...TRANSCRIPTION_LANGUAGES].sort((a, b) => a.name.localeCompare(b.name));
  return [{ value: AUTO_LANGUAGE, label: 'Auto-detect' }, ...sorted.map((l) => ({ value: l.code, label: label(l) }))];
}

export function languageDisplayName(code: string | null | undefined): string {
  const l = TRANSCRIPTION_LANGUAGES.find((x) => x.code === code);
  return l ? label(l) : 'Auto-detect';
}

/** Anything that is not a listed code is auto. */
export function normalizeChoice(code: string | null | undefined): string {
  const c = (code ?? '').trim().toLowerCase();
  return TRANSCRIPTION_LANGUAGES.some((l) => l.code === c) ? c : AUTO_LANGUAGE;
}

/** The `live` object of GET /api/meetings/transcription-languages. */
export interface LiveCapabilities {
  provider: 'recall' | 'soniox';
  can_change_during_meeting: boolean;
  english_only_low_latency: boolean;
  non_english_live_delay_minutes: string | null;
  auto_live_behaviour: 'english_low_latency' | 'detect_delayed' | 'detect';
}

/** Short note under the picker; null when there is nothing to warn about. */
export function languageChoiceHint(code: string, live: LiveCapabilities | undefined): string | null {
  if (!live || !live.english_only_low_latency) return null;
  if (code === 'en') return null;
  if (code === AUTO_LANGUAGE) {
    return live.auto_live_behaviour === 'english_low_latency'
      ? 'Live captions are in English. The final transcript detects the language automatically.'
      : null;
  }
  const minutes = live.non_english_live_delay_minutes ?? '3-10';
  return `Live captions in this language arrive about ${minutes.replace('-', ' to ')} minutes late. The final transcript is not affected.`;
}

/** Why "Change language" is disabled during a live meeting; null when it can be used. */
export function liveLanguageHelp(live: { can_change: boolean; reason: 'not_live' | 'provider_fixed' | null } | undefined): string | null {
  if (live?.can_change) return null;
  if (live?.reason === 'provider_fixed') {
    return 'The live transcript language is set when the bot joined and cannot be changed during the meeting. The final transcript still detects the language automatically.';
  }
  return 'The language can be changed only while the meeting is being recorded.';
}
