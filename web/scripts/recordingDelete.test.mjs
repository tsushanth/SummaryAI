// Unit tests for the delete-recording helpers. Run: npm test
// Node strips the TypeScript types on import (Node >= 22.18).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRecordingDataKey,
  deleteRecordingThenRefresh,
  canDeleteRecording,
  deleteConfirmMessage,
} from '../src/lib/recordingDelete.ts';

test('cache keys that show a recording or its counts are invalidated after a delete', () => {
  for (const key of [
    ['recordings', { per_page: 50 }],
    ['recording', 'abc', ['transcript', 'summary']],
    ['analytics', 'abc', '{}'],
    ['qa-history', 'abc'],
    ['meetings', {}],
    'folders',
    'tags',
    'weekly-stats',
  ]) {
    assert.equal(isRecordingDataKey(key), true, JSON.stringify(key));
  }
});

test('unrelated cache keys are left alone', () => {
  for (const key of ['subscription-status', 'calendar-connections', 'integrations', ['live-transcript', 'm1', 0], ['todos', {}], null, undefined, 42]) {
    assert.equal(isRecordingDataKey(key), false, JSON.stringify(key));
  }
});

test('delete calls the API once with the id, then refreshes the caches', async () => {
  const calls = [];
  const result = await deleteRecordingThenRefresh('rec-1', {
    remove: async (id) => calls.push(['remove', id]),
    refresh: async () => calls.push(['refresh']),
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [['remove', 'rec-1'], ['refresh']]);
});

test('a failed delete reports the message and does not refresh or pretend success', async () => {
  let refreshed = false;
  const result = await deleteRecordingThenRefresh('rec-2', {
    remove: async () => {
      throw new Error('Recording not found');
    },
    refresh: async () => {
      refreshed = true;
    },
  });
  assert.deepEqual(result, { ok: false, message: 'Recording not found' });
  assert.equal(refreshed, false);
});

test('a non-Error rejection still gives a readable message', async () => {
  const result = await deleteRecordingThenRefresh('rec-3', {
    remove: async () => Promise.reject('boom'),
    refresh: async () => {},
  });
  assert.deepEqual(result, { ok: false, message: 'Failed to delete recording' });
});

test('a refresh failure after a successful delete does not turn into an error', async () => {
  const result = await deleteRecordingThenRefresh('rec-4', {
    remove: async () => {},
    refresh: async () => {
      throw new Error('network');
    },
  });
  assert.deepEqual(result, { ok: true });
});

test('a meeting-bot recording that is still live cannot be deleted from the UI', () => {
  assert.equal(canDeleteRecording({ status: 'uploading', meeting_id: 'm1' }), false);
  assert.equal(canDeleteRecording({ status: 'uploading', meeting_id: null }), true); // manual upload in progress
  assert.equal(canDeleteRecording({ status: 'completed', meeting_id: 'm1' }), true);
  assert.equal(canDeleteRecording({ status: 'failed', meeting_id: null }), true);
});

test('confirmation text names the recording and says it cannot be undone', () => {
  const msg = deleteConfirmMessage('Weekly Sync');
  assert.match(msg, /Weekly Sync/);
  assert.match(msg, /cannot be undone/i);
  assert.match(msg, /transcript/i);
  assert.match(deleteConfirmMessage(''), /this recording/i);
});
