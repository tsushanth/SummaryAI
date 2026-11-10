/**
 * Per-meeting transcription language: storage helpers (user default, bot run / meeting columns, final-transcript hint).
 * Every read of a column that migration 027 adds is tolerant: before the migration is applied these return "auto"/null and
 * nothing else changes. See backend/LIVE_STT.md ("Transcription language").
 */
import { supabaseAdmin } from '../lib/supabase.js';
import { AUTO_LANGUAGE, normalizeTranscriptionLanguage, storedLanguageOrAuto } from '../lib/transcriptionLanguage.js';

export const ACTIVE_BOT_STATUSES = ['pending', 'joining', 'in_call', 'recording'];
const PREF_KEY = 'default_transcription_language';

export function isMissingColumn(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false;
  return (error.code === '42703' || error.code === 'PGRST204') && String(error.message ?? '').includes(column);
}

export async function getUserDefaultLanguage(userId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin.from('profiles').select('preferences').eq('id', userId).maybeSingle();
    return storedLanguageOrAuto((data as { preferences?: Record<string, unknown> } | null)?.preferences?.[PREF_KEY]);
  } catch {
    return AUTO_LANGUAGE;
  }
}

export async function setUserDefaultLanguage(userId: string, language: string): Promise<void> {
  const { data } = await supabaseAdmin.from('profiles').select('preferences').eq('id', userId).maybeSingle();
  const prefs = { ...((data as { preferences?: Record<string, unknown> } | null)?.preferences ?? {}) };
  if (language === AUTO_LANGUAGE) delete prefs[PREF_KEY];
  else prefs[PREF_KEY] = language;
  const { error } = await supabaseAdmin.from('profiles').update({ preferences: prefs }).eq('id', userId);
  if (error) throw new Error('Failed to save default language');
}

/** explicit request value > the meeting's stored value ('auto' counts) > the user's default > auto. Always a valid 'auto' | code. */
export async function resolveBotLanguage(opts: { explicit?: string | null; meetingValue?: unknown; userId: string }): Promise<string> {
  const explicit = opts.explicit ? normalizeTranscriptionLanguage(opts.explicit) : null;
  if (explicit) return explicit;
  // The meeting's own value wins, including an explicit 'auto'. NULL (never chosen) follows the user's current default.
  const stored = normalizeTranscriptionLanguage(opts.meetingValue);
  if (stored) return stored;
  return getUserDefaultLanguage(opts.userId);
}

export interface RunLanguageInfo {
  id: string;
  status: string;
  live_stt_ref: string | null;
  live_stt_provider: string | null;
  transcription_language: string | null;
  /** bot_runs.live_stt_fallback (migration 030); null when never switched or the column does not exist yet. */
  live_stt_fallback: unknown;
}

/** Latest bot run of a meeting with the columns this feature needs, tolerant of columns that do not exist yet. */
export async function getLatestRunInfo(meetingId: string, opts: { activeOnly?: boolean } = {}): Promise<RunLanguageInfo | null> {
  const attempts = [
    'id, status, live_stt_ref, live_stt_provider, transcription_language, live_stt_fallback',
    'id, status, live_stt_ref, live_stt_provider, transcription_language',
    'id, status, live_stt_ref, live_stt_provider',
    'id, status',
  ];
  for (const cols of attempts) {
    let q = supabaseAdmin.from('bot_runs').select(cols).eq('meeting_id', meetingId);
    if (opts.activeOnly) q = q.in('status', ACTIVE_BOT_STATUSES);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) continue;
    if (!data) return null;
    const d = data as unknown as Partial<RunLanguageInfo> & { id: string; status: string };
    return {
      id: d.id,
      status: d.status,
      live_stt_ref: d.live_stt_ref ?? null,
      live_stt_provider: d.live_stt_provider ?? null,
      transcription_language: d.transcription_language ?? null,
      live_stt_fallback: (d as { live_stt_fallback?: unknown }).live_stt_fallback ?? null,
    };
  }
  return null;
}

/**
 * The language to pass to the final-transcript STT as a hint: the latest bot run's, else the meeting's. null = auto-detect.
 * Never throws (a hint must not block processing).
 */
export async function languageHintForRecording(recording: { meeting_id?: string | null }): Promise<string | null> {
  const meetingId = recording.meeting_id;
  if (!meetingId) return null;
  try {
    const run = await getLatestRunInfo(meetingId);
    const fromRun = normalizeTranscriptionLanguage(run?.transcription_language);
    if (fromRun && fromRun !== AUTO_LANGUAGE) return fromRun;
    const { data, error } = await supabaseAdmin.from('meetings').select('transcription_language').eq('id', meetingId).maybeSingle();
    if (error) return null;
    const fromMeeting = normalizeTranscriptionLanguage((data as { transcription_language?: string | null } | null)?.transcription_language);
    return fromMeeting && fromMeeting !== AUTO_LANGUAGE ? fromMeeting : null;
  } catch {
    return null;
  }
}
