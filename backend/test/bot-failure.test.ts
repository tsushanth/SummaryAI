// A bot that fails or is never admitted ends up `failed`, with Recall's reason, on the run, the meeting and the recording.
// Webhook bodies use the documented shape: { event, data: { data: { code, sub_code, updated_at }, bot: { id, metadata } } }.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { FakeDb } from './helpers-fakeDb.js';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/lib/supabase.js', () => ({ get supabaseAdmin() { return h.db; } }));
const reportFailure = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/failureReporter.js', () => ({ reportFailure: (...a: any[]) => reportFailure(...a), reportBackendError: vi.fn() }));
const recall = vi.hoisted(() => ({ getBot: vi.fn(), finalize: vi.fn() }));
vi.mock('../src/services/recallService.js', () => ({ RecallService: { getBot: recall.getBot }, finalizeBotRecording: recall.finalize }));

const { recallStatusDetail, neverRecordedOutcome } = await import('../src/lib/recallStatus.js');
const { upcomingMeetingsFilter } = await import('../src/lib/meetingListFilter.js');
const { reconcileStuckBotRecordings, expireStaleBotRuns } = await import('../src/services/stuckMeetingRecovery.js');
const { default: webhooks } = await import('../src/routes/webhooks.js');

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/webhooks', webhooks);
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let db: FakeDb;
beforeEach(() => {
  db = new FakeDb();
  h.db = db;
  reportFailure.mockClear(); recall.getBot.mockReset(); recall.finalize.mockReset();
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
function seed(run: Record<string, unknown> = {}, recording: Record<string, unknown> = {}) {
  const rec = db.seed('recordings', { status: 'pending', source: 'meeting_bot', file_path: null, ...recording });
  const meeting = db.seed('meetings', { status: 'bot_joining', recording_id: rec.id });
  const botRun = db.seed('bot_runs', {
    meeting_id: meeting.id, recall_bot_id: 'bot-1', status: 'joining', joined_at: null, created_at: ago(60_000), updated_at: ago(10 * 60_000), ...run,
  });
  return { rec, meeting, botRun };
}
const event = (name: string, subCode: string | null) => ({
  event: name,
  data: { data: { code: name.replace('bot.', ''), sub_code: subCode, updated_at: ago(0) }, bot: { id: 'bot-1', metadata: {} } },
});
const post = async (body: unknown) =>
  (await fetch(`${base}/v1/webhooks/recall`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status;
const neverAdmitted = {
  status_changes: [{ code: 'joining_call' }, { code: 'in_waiting_room' }, { code: 'call_ended', sub_code: 'timeout_exceeded_waiting_room' }, { code: 'done' }],
  recordings: [],
};

describe('reading the reason', () => {
  it('takes data.data.sub_code (documented) and the flat data.sub_code', () => {
    expect(recallStatusDetail({ data: { sub_code: 'meeting_password_incorrect' } }).subCode).toBe('meeting_password_incorrect');
    expect(recallStatusDetail({ sub_code: 'meeting_not_found' }).subCode).toBe('meeting_not_found');
    expect(recallStatusDetail({ data: { sub_code: null } }).subCode).toBeNull();
    expect(recallStatusDetail(undefined)).toEqual({ subCode: null, message: null });
  });

  it('never-recorded needs a finished bot with no recording', () => {
    expect(neverRecordedOutcome(neverAdmitted)).toEqual({ code: 'timeout_exceeded_waiting_room' });
    expect(neverRecordedOutcome({ status_changes: [{ code: 'joining_call' }, { code: 'fatal', sub_code: 'meeting_not_found' }] })).toEqual({ code: 'meeting_not_found' });
    expect(neverRecordedOutcome({ status_changes: [{ code: 'done' }] })).toEqual({ code: 'bot_never_recorded' });
    expect(neverRecordedOutcome({ status_changes: [{ code: 'joining_call' }, { code: 'in_waiting_room' }] })).toBeNull();
    expect(neverRecordedOutcome({ status_changes: [{ code: 'in_call_recording' }, { code: 'done' }] })).toBeNull();
    expect(neverRecordedOutcome({ status_changes: [{ code: 'done' }], recordings: [{}] })).toBeNull();
    expect(neverRecordedOutcome({})).toBeNull();
  });
});

describe('webhooks', () => {
  for (const [name, body] of [
    ['nested', event('bot.fatal', 'meeting_password_incorrect')],
    ['flat', { event: 'bot.fatal', data: { bot_id: 'bot-1', sub_code: 'meeting_password_incorrect' } }],
  ] as const) {
    it(`bot.fatal (${name}) stores the sub_code on all three rows`, async () => {
      const { rec, meeting, botRun } = seed();
      expect(await post(body)).toBe(200);
      expect(botRun).toMatchObject({ status: 'failed', recall_status: 'fatal', error_code: 'meeting_password_incorrect' });
      expect(meeting).toMatchObject({ status: 'failed', error_message: 'meeting_password_incorrect' });
      expect(rec).toMatchObject({ status: 'failed', error_code: 'meeting_password_incorrect' });
    });
  }

  it('bot.fatal without a sub_code stores a generic code', async () => {
    const { rec, botRun } = seed();
    await post(event('bot.fatal', null));
    expect(botRun).toMatchObject({ error_code: 'bot_fatal', error_message: 'Bot encountered a fatal error' });
    expect(rec.error_code).toBe('bot_fatal');
  });

  it('bot.recording_permission_denied stores the nested sub_code', async () => {
    const { rec, meeting, botRun } = seed({ status: 'in_call' });
    await post(event('bot.recording_permission_denied', 'zoom_local_recording_request_denied_by_host'));
    expect(botRun.error_code).toBe('zoom_local_recording_request_denied_by_host');
    expect(meeting.error_message).toBe('zoom_local_recording_request_denied_by_host');
    expect(rec.error_code).toBe('zoom_local_recording_request_denied_by_host');
  });

  it('never admitted: call_ended then done leaves everything failed', async () => {
    const { rec, meeting, botRun } = seed();
    await post(event('bot.call_ended', 'timeout_exceeded_waiting_room'));
    await post(event('bot.done', null));
    expect(botRun).toMatchObject({ status: 'failed', error_code: 'timeout_exceeded_waiting_room' });
    expect(meeting).toMatchObject({ status: 'failed', error_message: 'timeout_exceeded_waiting_room' });
    expect(rec).toMatchObject({ status: 'failed', error_code: 'timeout_exceeded_waiting_room' });
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledTimes(1));
    expect(reportFailure.mock.calls[0][2].code).toBe('BOT_NEVER_RECORDED');
  });

  it('a normal call end still goes to processing', async () => {
    const { rec, meeting, botRun } = seed({ status: 'recording', joined_at: ago(60_000) }, { status: 'uploading' });
    await post(event('bot.call_ended', 'timeout_exceeded_everyone_left'));
    expect(botRun.status).toBe('processing');
    expect(meeting.status).toBe('bot_left');
    expect(rec.status).toBe('uploading');
  });

  it('a waiting-room timeout after the bot had joined is not treated as never admitted', async () => {
    const { rec, botRun } = seed({ status: 'recording', joined_at: ago(60_000) }, { status: 'uploading' });
    await post(event('bot.call_ended', 'timeout_exceeded_waiting_room'));
    expect(botRun.status).toBe('processing');
    expect(rec.status).toBe('uploading');
  });

  it('a bot that had joined and was then failed still gets its leave time (monthly allowance)', async () => {
    const { meeting, botRun } = seed({ status: 'in_call', joined_at: ago(600_000) });
    await post(event('bot.recording_permission_denied', 'zoom_local_recording_denied'));
    await post(event('bot.call_ended', 'call_ended_by_host'));
    expect(botRun.left_at).toBeTruthy();
    expect([botRun.status, meeting.status]).toEqual(['failed', 'failed']);
  });

  it('never admitted leaves a meeting that was switched back to scheduled alone', async () => {
    const { meeting, botRun } = seed();
    meeting.status = 'scheduled';
    await post(event('bot.call_ended', 'timeout_exceeded_waiting_room'));
    expect(botRun.status).toBe('failed');
    expect(meeting.status).toBe('scheduled');
  });

  it('events after a failure (call_ended, done, joining_call, in_waiting_room) do not revive it', async () => {
    const { meeting, botRun } = seed();
    await post(event('bot.fatal', 'meeting_not_found'));
    for (const name of ['bot.call_ended', 'bot.done', 'bot.joining_call', 'bot.in_waiting_room']) await post(event(name, null));
    expect(botRun.status).toBe('failed');
    expect(meeting.status).toBe('failed');
  });

  it('never admitted on an older run leaves the meeting and recording to the newer run', async () => {
    const { rec, meeting, botRun } = seed({ created_at: ago(3600_000) });
    db.seed('bot_runs', { meeting_id: meeting.id, recall_bot_id: 'bot-2', status: 'joining', created_at: ago(1000) });
    await post(event('bot.call_ended', 'timeout_exceeded_waiting_room'));
    expect(botRun.status).toBe('failed');
    expect(meeting.status).toBe('bot_joining');
    expect(rec.status).toBe('pending');
  });
});

describe('reconciler', () => {
  it('fails a processing run with a pending recording when Recall says it never recorded; old rows are not reported', async () => {
    const { rec, meeting, botRun } = seed({ status: 'processing', created_at: ago(90 * 86400_000) });
    meeting.status = 'bot_left';
    recall.getBot.mockResolvedValue(neverAdmitted);
    await reconcileStuckBotRecordings();
    expect(botRun).toMatchObject({ status: 'failed', error_code: 'timeout_exceeded_waiting_room' });
    expect(meeting.status).toBe('failed');
    expect(rec.status).toBe('failed');
    await new Promise((r) => setTimeout(r, 20));
    expect(reportFailure).not.toHaveBeenCalled();
    expect(recall.finalize).not.toHaveBeenCalled();
  });

  it('also closes a never-recorded run that has no recording row', async () => {
    const meeting = db.seed('meetings', { status: 'bot_left', recording_id: null });
    const run = db.seed('bot_runs', { meeting_id: meeting.id, recall_bot_id: 'bot-1', status: 'processing', updated_at: ago(600_000) });
    recall.getBot.mockResolvedValue(neverAdmitted);
    await reconcileStuckBotRecordings();
    expect([run.status, meeting.status]).toEqual(['failed', 'failed']);
  });

  it('changes nothing when Recall shows it recorded, or when Recall cannot be asked', async () => {
    const { rec, botRun } = seed({ status: 'processing' });
    recall.getBot.mockResolvedValueOnce({ status_changes: [{ code: 'in_call_recording' }, { code: 'done' }] });
    await reconcileStuckBotRecordings();
    recall.getBot.mockRejectedValueOnce(new Error('Recall API error: 500'));
    await reconcileStuckBotRecordings();
    expect(botRun.status).toBe('processing');
    expect(rec.status).toBe('pending');
  });

  it('24 h stale joining run: fails meeting and recording when Recall confirms, otherwise only the run', async () => {
    const a = seed({ updated_at: ago(30 * 3600_000), created_at: ago(30 * 3600_000) });
    recall.getBot.mockResolvedValueOnce(neverAdmitted);
    expect(await expireStaleBotRuns()).toBe(1);
    expect([a.botRun.status, a.meeting.status, a.rec.status]).toEqual(['failed', 'failed', 'failed']);

    db = new FakeDb(); h.db = db;
    const b = seed({ updated_at: ago(30 * 3600_000) });
    recall.getBot.mockRejectedValueOnce(new Error('Recall API error: 404'));
    expect(await expireStaleBotRuns()).toBe(1);
    expect(b.botRun).toMatchObject({ status: 'failed', error_code: 'STATUS_NEVER_REPORTED' });
    expect([b.meeting.status, b.rec.status]).toEqual(['bot_joining', 'pending']);
  });
});

describe('upcoming list filter', () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z');

  it('is unchanged without include_recent (Android and other clients)', () => {
    expect(upcomingMeetingsFilter(now, 14, false)).toBe(
      'and(scheduled_start.gte.2026-11-25T12:00:00.000Z,scheduled_start.lte.2026-12-09T12:00:00.000Z),' +
        'and(scheduled_start.lt.2026-11-25T12:00:00.000Z,scheduled_end.gt.2026-11-25T12:00:00.000Z)'
    );
  });

  it('with include_recent adds started active meetings (24 h) and failures (7 days)', () => {
    const f = upcomingMeetingsFilter(now, 14, true);
    expect(f).toContain('and(status.in.(bot_queued,bot_joining,bot_in_meeting,bot_left),scheduled_start.lt.2026-11-25T12:00:00.000Z,scheduled_start.gte.2026-11-24T12:00:00.000Z)');
    expect(f).toContain('and(status.eq.failed,scheduled_start.lt.2026-11-25T12:00:00.000Z,scheduled_start.gte.2026-11-18T12:00:00.000Z)');
  });
});
