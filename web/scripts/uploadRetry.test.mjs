// Retry policy for the browser's PUT to the signed storage URL. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  UploadError,
  isRetryableUploadStatus,
  uploadRetryDelayMs,
  uploadFailureMessage,
  withUploadRetry,
  UPLOAD_MAX_ATTEMPTS,
} from '../src/lib/uploadRetry.ts';

const noSleep = async () => {};

test('transient statuses retry, permanent ones do not', () => {
  for (const s of [0, 408, 429, 500, 502, 503, 504, 599]) assert.equal(isRetryableUploadStatus(s), true, String(s));
  for (const s of [400, 401, 403, 404, 413, 422]) assert.equal(isRetryableUploadStatus(s), false, String(s));
});

test('a 504 then success resolves after one retry, with the backoff and a progress reset', async () => {
  let calls = 0;
  const delays = [];
  const retries = [];
  const out = await withUploadRetry(
    async () => {
      calls++;
      if (calls === 1) throw new UploadError(504, 'x');
      return 'ok';
    },
    { sleep: async (ms) => void delays.push(ms), onRetry: (n, s) => retries.push([n, s]) },
  );
  assert.equal(out, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(delays, [uploadRetryDelayMs(1)]);
  assert.deepEqual(retries, [[1, 504]]);
});

test('gives up after the max attempts and rethrows the last error', async () => {
  let calls = 0;
  await assert.rejects(
    withUploadRetry(async () => { calls++; throw new UploadError(0, 'net'); }, { sleep: noSleep }),
    (e) => e instanceof UploadError && e.status === 0,
  );
  assert.equal(calls, UPLOAD_MAX_ATTEMPTS);
  assert.equal(UPLOAD_MAX_ATTEMPTS, 3);
});

test('403 (expired link) and other 4xx are not retried; non-UploadErrors are rethrown at once', async () => {
  let calls = 0;
  await assert.rejects(withUploadRetry(async () => { calls++; throw new UploadError(403, 'expired'); }, { sleep: noSleep }));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(withUploadRetry(async () => { calls++; throw new TypeError('bug'); }, { sleep: noSleep }), TypeError);
  assert.equal(calls, 1);
});

test('failure messages say what to do and that the audio is kept', () => {
  assert.match(uploadFailureMessage(504), /saved in this browser/);
  assert.match(uploadFailureMessage(0), /saved in this browser/);
  assert.match(uploadFailureMessage(403), /expired/);
  assert.match(uploadFailureMessage(413), /too large/);
  assert.ok(!/^Upload failed$/.test(uploadFailureMessage(500)), 'no bare "Upload failed"');
});

test('uploadAudio is wired through the retry helper and no longer rejects with a bare "Upload failed"', () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/api/recordings.ts'), 'utf8');
  assert.ok(src.includes('withUploadRetry('));
  assert.ok(!src.includes("new Error('Upload failed')"));
  assert.ok(src.includes('xhr.ontimeout'));
});
