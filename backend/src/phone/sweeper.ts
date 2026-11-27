/**
 * One pass every minute: releases unused reservations, settles finished calls (and cuts off overrunning ones), saves any
 * recording whose webhook was lost or failed, and reports transcription outcomes.
 */
import type { PhoneDeps } from './deps.js';
import { settleCall } from './calls.js';
import { ingestRecording } from './recordings.js';
import { carrierCode } from './gateway.js';
import { maintainNumbers } from './provision.js';
import { reconcileAgentResults } from './agents.js';

export const PHONE_SWEEP_INTERVAL_MS = 60_000;
const LOOKBACK_MS = 48 * 3600_000;
/** The webhook normally saves a recording within seconds; the sweeper starts after this. */
const RECORDING_GRACE_MS = 3 * 60_000;
const RECORDING_MISSING_AFTER_MS = 3600_000;

/** Slow jobs run on every tenth pass. */
const MAINTAIN_EVERY = 10;
let passes = 0;

export async function sweepPhoneCalls(d: PhoneDeps): Promise<void> {
  await d.store.releaseStale();

  for (const row of await d.store.openCalls()) {
    // A call claimed seconds ago is still being set up.
    if (d.now() - Date.parse(row.claimed_at ?? '') < 45_000) continue;
    await settleCall(d, row.call_id, row);
  }

  const since = new Date(d.now() - LOOKBACK_MS).toISOString();
  const before = new Date(d.now() - RECORDING_GRACE_MS).toISOString();
  for (const call of await d.store.callsNeedingRecordingWork(since, before)) {
    const ledger = await d.store.ledgerCall(call.id);
    // Wait until the call is over; an unanswered call has nothing to save.
    if (!ledger || ledger.state !== 'settled' || !call.twilio_call_sid) continue;
    if (!call.recording_sid && !call.recording_stored_at && !ledger.notice_served_at) continue;
    let found;
    try { found = await d.gateway.listRecordings(call.twilio_call_sid); }
    catch (e) { d.alert('RECORDING_LIST_FAILED', { code: carrierCode(e) }); continue; }
    for (const rec of found) {
      await ingestRecording(d, call.id, { sid: rec.sid, callSid: call.twilio_call_sid, status: rec.status, durationSeconds: rec.durationSeconds });
    }
    if (!found.length) {
      if (call.recording_stored_at) {
        await d.store.updateCall(call.id, { recording_deleted_at: new Date(d.now()).toISOString() });
      } else if ((ledger.actual_seconds ?? 0) > 10 && !call.failure_reason && d.now() - Date.parse(call.created_at) > RECORDING_MISSING_AFTER_MS) {
        await d.store.updateCall(call.id, { failure_reason: 'recording_missing' });
        await d.track('call_discarded', call.user_id, { reason: 'recording_missing' });
        d.alert('RECORDING_MISSING');
      }
    }
  }

  for (const call of await d.store.callsAwaitingTranscript(since)) {
    const rec = await d.store.recordingStatus(call.id);
    const result = !rec ? 'deleted' : rec.status === 'completed' ? 'completed' : rec.status === 'failed' ? 'failed' : null;
    if (!result) continue;
    await d.store.updateCall(call.id, { transcript_result: result });
    if (result === 'completed') await d.track('call_transcribed', call.user_id, { reason: rec?.error_code ?? 'ok' });
    if (result === 'failed') {
      await d.track('call_transcribe_failed', call.user_id, { reason: rec?.error_code ?? 'unknown' });
      d.alert('CALL_TRANSCRIPT_FAILED', { code: String(rec?.error_code ?? 'unknown') });
    }
  }

  if (d.extras) {
    await reconcileAgentResults(d, d.extras);
    if (passes++ % MAINTAIN_EVERY === 0) await maintainNumbers(d, d.extras);
  }
}
