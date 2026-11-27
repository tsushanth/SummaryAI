/**
 * Turns a finished call recording into a normal recording of the user (list, transcript, summary), then deletes the
 * carrier's copy. Repeatable: the recording row uses the call id, so a repeated webhook or the sweeper cannot duplicate it.
 */
import type { PhoneDeps } from './deps.js';
import { carrierCode } from './gateway.js';
import { MIN_RECORDING_SECONDS } from './constants.js';
import { isUuid } from './calls.js';
import type { CallRow } from './store.js';
import { PHONE_CALL_SOURCE } from '../services/summaryService.js';

export const recordingTitle = (call: Pick<CallRow, 'to_name' | 'to_number'>): string =>
  // The Android app translates these two fixed forms (strings server_title_call_with / server_title_call_to).
  call.to_name ? `Call with ${call.to_name}` : `Call to ${call.to_number}`;

const REMOVE_ATTEMPT = async (d: PhoneDeps, call: CallRow, sid: string): Promise<void> => {
  try {
    await d.gateway.deleteRecording(sid);
    await d.store.updateCall(call.id, { recording_deleted_at: new Date(d.now()).toISOString() });
  } catch (e) {
    d.alert('RECORDING_DELETE_FAILED', { code: carrierCode(e) }); // the sweeper tries again
  }
};

async function discard(d: PhoneDeps, call: CallRow, sid: string, reason: string): Promise<'discarded'> {
  await d.store.updateCall(call.id, { recording_sid: sid, failure_reason: reason });
  await REMOVE_ATTEMPT(d, call, sid);
  if (call.failure_reason !== reason) await d.track('call_discarded', call.user_id, { reason });
  return 'discarded';
}

export async function ingestRecording(
  d: PhoneDeps, callId: string, rec: { sid: string; callSid: string; status: string; durationSeconds: number },
): Promise<'stored' | 'discarded' | 'ignored' | 'failed'> {
  if (!isUuid(callId) || !/^RE[0-9a-f]{32}$/i.test(rec.sid) || rec.status !== 'completed') return 'ignored';
  const call = await d.store.getCall(callId);
  if (!call || call.twilio_account !== 'phone' || !rec.callSid || call.twilio_call_sid !== rec.callSid) {
    d.alert('RECORDING_UNMATCHED');
    return 'ignored';
  }
  if (call.recording_stored_at) {
    if (!call.recording_deleted_at) await REMOVE_ATTEMPT(d, call, rec.sid);
    return 'ignored';
  }
  const ledger = await d.store.ledgerCall(callId);
  if (!ledger?.notice_served_at) {
    // No proof the called person was told: the audio is deleted unheard.
    d.alert('NOTICE_NOT_SERVED');
    return discard(d, call, rec.sid, 'notice_missing');
  }
  if (rec.durationSeconds < MIN_RECORDING_SECONDS) return discard(d, call, rec.sid, 'too_short');
  if (!(await d.store.claimRecording(callId, rec.sid))) return 'ignored';

  try {
    const audio = await d.gateway.downloadRecording(rec.sid);
    if (!audio.length) throw new Error('empty audio');
    const path = `${call.user_id}/phone-call-${call.id}.mp3`;
    await d.store.uploadAudio(path, audio);
    const outcome = await d.store.insertRecording({
      id: call.id,
      user_id: call.user_id,
      title: recordingTitle(call),
      file_path: path,
      file_size_bytes: audio.length,
      duration_seconds: Math.max(1, Math.round(rec.durationSeconds)),
      status: 'uploaded',
      source: PHONE_CALL_SOURCE, // also what keeps the recording itself out of the summary
      recording_type: 'meeting',
      content_type: 'audio/mpeg',
      output_language: call.output_language,
    });
    await d.store.updateCall(call.id, { recording_id: call.id, recording_stored_at: new Date(d.now()).toISOString(), failure_reason: null });
    if (outcome === 'inserted') {
      await d.track('call_recorded', call.user_id, { seconds: Math.round(rec.durationSeconds) });
      // A failure here leaves the row 'uploaded', which the orphaned-processing recovery picks up.
      await d.process(call.id, call.user_id).catch(() => d.alert('PROCESSING_START_FAILED'));
    }
    await REMOVE_ATTEMPT(d, { ...call, recording_deleted_at: null }, rec.sid);
    return 'stored';
  } catch (e) {
    d.alert('RECORDING_STORE_FAILED', { code: carrierCode(e) });
    return 'failed'; // the carrier copy stays until the sweeper has saved it
  }
}
