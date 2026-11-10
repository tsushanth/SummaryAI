// New Recording page helpers: default title, blank-title fallback, and the reason shown while the button is disabled.
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  defaultRecordingTitle,
  resolveRecordingTitle,
  submitBlockedReason,
  RECORDING_MINIMUM_HINT,
} from '../src/lib/newRecordingForm.ts';

test('defaultRecordingTitle: local date and 12-hour time', () => {
  assert.equal(defaultRecordingTitle(new Date(2026, 10, 5, 15, 42)), 'Recording Nov 5, 3:42 PM');
  assert.equal(defaultRecordingTitle(new Date(2026, 0, 31, 0, 5)), 'Recording Jan 31, 12:05 AM');
  assert.equal(defaultRecordingTitle(new Date(2026, 5, 1, 12, 0)), 'Recording Jun 1, 12:00 PM');
});

test('resolveRecordingTitle: typed title wins, blank or whitespace falls back, never empty', () => {
  assert.equal(resolveRecordingTitle('  Standup ', 'Recording Nov 5, 3:42 PM'), 'Standup');
  assert.equal(resolveRecordingTitle('   ', 'Recording Nov 5, 3:42 PM'), 'Recording Nov 5, 3:42 PM');
  assert.match(resolveRecordingTitle('', ''), /^Recording /);
});

test('submitBlockedReason: says what is missing, null when ready or busy', () => {
  const base = { mode: 'record', hasAudio: false, isRecording: false, isSubmitting: false };
  assert.match(submitBlockedReason(base), /Record something first/);
  assert.match(submitBlockedReason({ ...base, isRecording: true }), /Stop the recording/);
  assert.equal(submitBlockedReason({ ...base, hasAudio: true }), null);
  assert.match(submitBlockedReason({ ...base, mode: 'upload' }), /Choose an audio file/);
  assert.equal(submitBlockedReason({ ...base, mode: 'upload', hasAudio: true }), null);
  assert.equal(submitBlockedReason({ ...base, isSubmitting: true }), null);
});

test('record page no longer requires a title and shows the minimum-length hint', () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/app/(dashboard)/recordings/new/page.tsx'),
    'utf8',
  );
  assert.ok(!/Please enter a title/.test(src), 'a blank title must not block submit');
  assert.ok(!/title\.trim\(\) &&/.test(src), 'canSubmit must not depend on the typed title');
  assert.ok(src.includes('RECORDING_MINIMUM_HINT') && src.includes('blockedReason'));
  assert.match(RECORDING_MINIMUM_HINT, /30 seconds/);
  assert.match(RECORDING_MINIMUM_HINT, /25 words/);
});
