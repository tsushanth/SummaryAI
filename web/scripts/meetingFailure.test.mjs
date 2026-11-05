// Why a failed meeting failed, shown on the meeting card and detail page. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  meetingFailureReason,
  formatResetDate,
  isBotCapMessage,
  GENERIC_FAILURE,
  BOT_MONTHLY_CAP_REACHED,
} from '../src/lib/meetingFailure.ts';

// The text the backend stores on a scheduled meeting it refused (backend/src/services/botUsageCap.ts, botCapError).
const stored =
  'You have used your 10 free meeting-bot minutes for this month. The bot is available again on 2026-12-01 (UTC). Recording a meeting yourself still works.';

test('a meeting refused for the monthly allowance reads as one friendly sentence with the reset date', () => {
  assert.equal(
    meetingFailureReason({ status: 'failed', error_message: stored }, 'en-US'),
    "You have used this month's meeting bot time. It resets on December 1, 2026. You can still record meetings yourself."
  );
});

test('the date follows the locale', () => {
  assert.match(meetingFailureReason({ status: 'failed', error_message: stored }, 'de-DE'), /1\. Dezember 2026/);
});

test('the reset date is the UTC day, not the previous evening in a US time zone', () => {
  const prev = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(formatResetDate('2026-12-01T00:00:00.000Z', 'en-US'), 'December 1, 2026');
    assert.equal(formatResetDate('2026-12-01', 'en-US'), 'December 1, 2026');
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
});

test('a cap message without a readable date falls back to "the start of next month"', () => {
  assert.equal(
    meetingFailureReason({ status: 'failed', error_message: BOT_MONTHLY_CAP_REACHED }, 'en-US'),
    "You have used this month's meeting bot time. It resets at the start of next month. You can still record meetings yourself."
  );
  assert.equal(formatResetDate('soon'), null);
  assert.equal(formatResetDate(null), null);
});

test('any other failure gets the generic sentence and the stored text is never shown', () => {
  assert.equal(meetingFailureReason({ status: 'failed', error_message: '  Failed to start bot ' }), GENERIC_FAILURE);
  const raw = 'Recall API error: 400 - {"detail":"internal provider text"}';
  const shown = meetingFailureReason({ status: 'failed', error_message: raw });
  assert.equal(shown, GENERIC_FAILURE);
  assert.ok(!shown.includes('Recall') && !shown.includes('400'));
});

test('nothing is shown when the meeting did not fail or no reason was recorded', () => {
  assert.equal(meetingFailureReason({ status: 'completed', error_message: stored }), null);
  assert.equal(meetingFailureReason({ status: 'failed', error_message: null }), null);
  assert.equal(meetingFailureReason({ status: 'failed', error_message: '   ' }), null);
  assert.equal(meetingFailureReason({ status: 'failed' }), null);
});

test('isBotCapMessage does not match ordinary failures', () => {
  assert.equal(isBotCapMessage('Failed to start bot'), false);
  assert.equal(isBotCapMessage(null), false);
  assert.equal(isBotCapMessage(stored), true);
});

test('contract: the backend still stores the text this matches on (skipped until the backend allowance exists)', (t) => {
  let src;
  try {
    src = readFileSync(new URL('../../backend/src/services/botUsageCap.ts', import.meta.url), 'utf8');
  } catch {
    return t.skip('backend/src/services/botUsageCap.ts is not in this checkout');
  }
  assert.ok(src.includes(`'${BOT_MONTHLY_CAP_REACHED}'`));
  assert.ok(src.includes('meeting-bot minutes for this month'));
  assert.ok(src.includes('available again on'));
});
