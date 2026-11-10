// The recording detail page keeps polling while the recording is still in the pipeline. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isInProgressStatus, IN_PROGRESS_STATUSES } from '../src/lib/recordingStatus.ts';

test('every non-terminal status polls, terminal ones do not', () => {
  for (const s of ['pending', 'uploading', 'uploaded', 'transcribing', 'transcribed', 'summarizing']) {
    assert.equal(isInProgressStatus(s), true, s);
  }
  for (const s of ['completed', 'failed', undefined, null, '']) assert.equal(isInProgressStatus(s), false, String(s));
  assert.equal(IN_PROGRESS_STATUSES.length, 6);
});

test("the 'transcribed' step no longer stops the page refreshing (regression)", () => {
  const hook = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/hooks/useRecordings.ts'),
    'utf8',
  );
  assert.ok(hook.includes('isInProgressStatus'));
  assert.ok(!/status === 'uploaded'/.test(hook));
});
