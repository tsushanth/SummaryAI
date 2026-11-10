/**
 * Languages Soniox accepts as `language_hints` (docs.soniox.com/stt/concepts/supported-languages, 60 languages, 2026-11-03).
 * Anything else is dropped here: an unknown hint makes Soniox answer 400, which this service treats as fatal for the stream.
 * The backend applies a narrower allow-list (languages Recall supports too); the service accepts everything Soniox does.
 */
export const SONIOX_LANGUAGES: ReadonlySet<string> = new Set(
  ('af sq ar az eu be bn bs bg ca zh hr cs da nl en et fi fr gl de el gu he hi hu id it ja kn kk ko lv lt mk ms ml mr no fa pl pt pa ro ru sr sk sl es sw sv tl ta te th tr uk ur vi cy').split(' ')
);

/** Valid, lowercase language code, or null for 'auto' / missing / unknown. */
export function parseLanguage(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.trim().toLowerCase();
  return SONIOX_LANGUAGES.has(c) ? c : null;
}

/** `language_hints` for a requested language: one hint, or none (auto). */
export function languageHints(v: unknown): string[] {
  const c = parseLanguage(v);
  return c ? [c] : [];
}
