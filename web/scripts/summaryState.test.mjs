// Unit tests for the recording-page summary states (too short / no speech / abandoned upload). Run: npm test
// Node strips the TypeScript types on import (Node >= 22.18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSummaryView, recordingBadgeOverride } from '../src/lib/summaryState.ts';

const base = { status: 'completed', error_code: null, hasSummary: false };

test('a summary always wins, even on a recording flagged too short', () => {
  assert.equal(getSummaryView({ ...base, hasSummary: true, error_code: 'TOO_SHORT', summary_status: 'ready' }).kind, 'summary');
  assert.equal(getSummaryView({ ...base, hasSummary: true }).kind, 'summary');
});

test('too short from the API: clear title, the configured minimum, and a Record again action', () => {
  const v = getSummaryView({ ...base, summary_status: 'too_short', summary_min_seconds: 45 });
  assert.equal(v.kind, 'too_short');
  assert.equal(v.title, 'Too short to summarize');
  assert.equal(v.body, 'Record at least 45 seconds, or upload audio.');
  assert.equal(v.action?.label, 'Record again');
  assert.equal(v.action?.href, '/recordings/new');
});

test('too short without the new API fields (older backend): falls back to error_code and 30 s', () => {
  const v = getSummaryView({ ...base, error_code: 'TOO_SHORT' });
  assert.equal(v.kind, 'too_short');
  assert.equal(v.body, 'Record at least 30 seconds, or upload audio.');
});

test('no speech detected: its own message, still offers Record again', () => {
  for (const input of [{ summary_status: 'no_speech' }, { error_code: 'NO_SPEECH' }]) {
    const v = getSummaryView({ ...base, ...input });
    assert.equal(v.kind, 'no_speech');
    assert.equal(v.title, 'No speech detected');
    assert.match(v.body, /microphone/);
    assert.equal(v.action?.label, 'Record again');
  }
});

test('abandoned upload: explains and offers Record again', () => {
  const v = getSummaryView({ status: 'failed', error_code: 'FAILED_UPLOAD', hasSummary: false });
  assert.equal(v.kind, 'failed_upload');
  assert.equal(v.action?.label, 'Record again');
});

test('processing and ordinary no-summary states keep the old wording and have no action', () => {
  const p = getSummaryView({ status: 'transcribing', error_code: null, hasSummary: false });
  assert.equal(p.kind, 'processing');
  assert.equal(p.body, 'Summary will appear here once processing is complete.');
  assert.equal(p.action, undefined);
  const n = getSummaryView({ status: 'failed', error_code: 'PROCESSING_ERROR', hasSummary: false });
  assert.equal(n.kind, 'empty');
  assert.equal(n.body, 'No summary available.');
  assert.equal(getSummaryView({ ...base }).kind, 'empty');
});

test('list badge: only completed short rows and abandoned uploads are relabelled', () => {
  assert.deepEqual(recordingBadgeOverride({ status: 'completed', error_code: 'TOO_SHORT' }), { label: 'Too short', tone: 'muted' });
  assert.deepEqual(recordingBadgeOverride({ status: 'completed', error_code: 'NO_SPEECH' }), { label: 'No speech', tone: 'muted' });
  assert.deepEqual(recordingBadgeOverride({ status: 'failed', error_code: 'FAILED_UPLOAD' }), { label: 'Upload failed', tone: 'error' });
  assert.equal(recordingBadgeOverride({ status: 'completed', error_code: null }), null);
  assert.equal(recordingBadgeOverride({ status: 'failed', error_code: 'PROCESSING_ERROR' }), null);
  assert.equal(recordingBadgeOverride({ status: 'completed' }), null);
});
