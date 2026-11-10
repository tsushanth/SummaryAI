/**
 * recordings.duration_seconds is what every client's detail page shows as the length. Clients report it when they create the
 * recording, but not all do (the web app did not), and the column then stays NULL although the transcription provider measured
 * the audio. These helpers decide what, if anything, to write back after transcription.
 */
import { supabaseAdmin } from '../lib/supabase.js';

/** Sanity ceiling for a provider-measured length (24 h); anything above is a provider glitch, not a recording. */
const MAX_MEASURED_SECONDS = 24 * 3600;

/**
 * The integer seconds to store, or null when nothing should be written: the client already gave a valid (positive) length, or the
 * provider's value is unknown / not a positive finite number / implausibly large. The column is an INTEGER with CHECK (> 0).
 */
export function measuredDurationToStore(
  providerSeconds: number | null | undefined,
  clientSeconds: number | null | undefined
): number | null {
  if (typeof clientSeconds === 'number' && clientSeconds > 0) return null;
  if (typeof providerSeconds !== 'number' || !Number.isFinite(providerSeconds)) return null;
  const rounded = Math.round(providerSeconds);
  if (rounded < 1 || rounded > MAX_MEASURED_SECONDS) return null;
  return rounded;
}

/**
 * Write the measured length, only where the column is still NULL/0 (never overwrites a client value, safe to repeat, safe against a
 * concurrent writer). Best effort: a failure is logged and never fails the recording.
 */
export async function storeMeasuredDuration(
  recordingId: string,
  providerSeconds: number | null | undefined,
  clientSeconds: number | null | undefined
): Promise<number | null> {
  const seconds = measuredDurationToStore(providerSeconds, clientSeconds);
  if (seconds === null) return null;
  try {
    const { error } = await supabaseAdmin
      .from('recordings')
      .update({ duration_seconds: seconds })
      .eq('id', recordingId)
      .or('duration_seconds.is.null,duration_seconds.eq.0');
    if (error) {
      console.warn(`[Processing] could not store measured duration for ${recordingId}: ${error.message}`);
      return null;
    }
    return seconds;
  } catch (e) {
    console.warn(`[Processing] could not store measured duration for ${recordingId}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
