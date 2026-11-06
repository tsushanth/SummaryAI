/**
 * Language gate for the self-hosted Whisper candidate. The worker is only trusted for the languages below; other languages
 * (Hindi, Indonesian, Ukrainian and Vietnamese are known to come out badly) must keep using the existing provider.
 *
 *  - Before the call: a per-meeting language hint outside the set means the candidate is not used and no audio is sent to it.
 *  - After the call: with no hint (auto-detect), a detected language outside the set means the candidate's transcript is
 *    discarded and the existing provider's result is used.
 */
import { AUTO_LANGUAGE, normalizeTranscriptionLanguage } from '../../lib/transcriptionLanguage.js';

export const READALOUD_TRUSTED_LANGUAGES: ReadonlySet<string> = new Set(['en', 'es', 'fr', 'de', 'pt', 'ru', 'ja', 'zh']);

/** Reason to skip the candidate for this hint, or null when there is no hint, the hint is auto, or the language is trusted. */
export function languageHintSkipReason(hints: string[] | undefined, trusted: ReadonlySet<string> = READALOUD_TRUSTED_LANGUAGES): string | null {
  const raw = hints?.[0];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = normalizeTranscriptionLanguage(raw);
  if (n === AUTO_LANGUAGE) return null;
  if (n === null) return 'language_hint_unrecognised';
  return trusted.has(n) ? null : 'language_hint_unsupported';
}

/** Reason to discard a result whose detected language is outside the trusted set, else null. */
export function detectedLanguageRejectReason(detected: string | undefined, trusted: ReadonlySet<string> = READALOUD_TRUSTED_LANGUAGES): string | null {
  const code = String(detected ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return trusted.has(code) ? null : 'language_unsupported';
}

/** True when the caller pinned a language (a non-blank, non-auto hint). */
export function hasLanguageHint(hints: string[] | undefined): boolean {
  const raw = hints?.[0];
  if (raw === undefined || raw === null || String(raw).trim() === '') return false;
  return normalizeTranscriptionLanguage(raw) !== AUTO_LANGUAGE;
}
