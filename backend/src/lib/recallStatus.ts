/**
 * Reading why a Recall.ai bot failed or left. Pure, no imports (web/scripts/meetingFailure.test.mjs loads it too).
 *
 * Status webhooks nest the reason: { event, data: { data: { code, sub_code, updated_at }, bot: { id, metadata } } }
 * (https://docs.recall.ai/docs/bot-status-change-events). A flat data.sub_code is still accepted.
 * GET /bot/{id} returns the same codes in status_changes[].
 */

/** Stored when a bot ended without recording and Recall gave no sub_code. */
export const NEVER_RECORDED_CODE = 'bot_never_recorded';

/** call_ended sub codes that mean the bot was never let into the meeting. */
export const NOT_ADMITTED_SUB_CODES: readonly string[] = [
  'timeout_exceeded_waiting_room',
  'call_ended_by_platform_waiting_room_timeout',
  'bot_kicked_from_waiting_room',
  'meeting_not_started',
];

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** The sub_code and message of a status webhook's `data`, in either shape. */
export function recallStatusDetail(data: unknown): { subCode: string | null; message: string | null } {
  const outer = record(data);
  const inner = record(outer.data);
  return {
    subCode: text(inner.sub_code) ?? text(outer.sub_code),
    message: text(inner.message) ?? text(outer.message),
  };
}

/**
 * For a GET /bot/{id} body: the reason code when the bot is finished and never recorded anything, else null
 * (still running, recorded something, or no status history to judge by).
 */
export function neverRecordedOutcome(bot: unknown): { code: string } | null {
  const body = record(bot);
  const changes = Array.isArray(body.status_changes) ? body.status_changes.map(record) : [];
  const find = (code: string) => changes.find((c) => c.code === code);
  const ended = find('fatal') ?? find('call_ended') ?? find('done');
  if (!ended) return null;
  if (find('in_call_recording') || find('recording_done')) return null;
  if (Array.isArray(body.recordings) && body.recordings.length > 0) return null;
  return {
    code: text(find('fatal')?.sub_code) ?? text(find('call_ended')?.sub_code) ?? text(find('done')?.sub_code) ?? NEVER_RECORDED_CODE,
  };
}
