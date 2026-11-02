/**
 * Languages the summary can be written in. Must stay within the backend's prompt map
 * (languageNameForCode in backend/src/services/processingService.ts): any other code is silently ignored there.
 * scripts/navTabsLanguage.test.mjs checks that. No runtime imports.
 */
export const OUTPUT_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
];

/** '' (or an unsupported code) means "same language as the recording": send nothing. */
export function outputLanguageParam(code: string | null | undefined): string | undefined {
  return code && OUTPUT_LANGUAGES.some((l) => l.code === code) ? code : undefined;
}
