// The detail page showed "Length 0:00" for web-recorded clips because the web app never sent duration_seconds when creating the
// recording (the backend stores NULL, the page rendered NULL as 0:00). Run: node --test scripts/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  sanitizeDurationSeconds,
  hasKnownDuration,
  RecordingClock,
  readAudioDuration,
  MAX_DURATION_SECONDS,
} from '../src/lib/recordingDuration.ts';
import { toCreateRecordingBody } from '../src/lib/createRecordingBody.ts';
import { createMemoryStore, uploadWithPersistence } from '../src/lib/pendingUpload.ts';

test('sanitizeDurationSeconds: rounds to a positive integer, rejects anything implausible', () => {
  assert.equal(sanitizeDurationSeconds(45), 45);
  assert.equal(sanitizeDurationSeconds(44.6), 45);
  assert.equal(sanitizeDurationSeconds(20.2), 20);
  assert.equal(sanitizeDurationSeconds(0.6), 1);
  for (const bad of [0, 0.4, -3, NaN, Infinity, -Infinity, null, undefined, '45', {}, MAX_DURATION_SECONDS + 1]) {
    assert.equal(sanitizeDurationSeconds(bad), undefined, `${String(bad)} must be rejected`);
  }
  assert.equal(sanitizeDurationSeconds(MAX_DURATION_SECONDS), MAX_DURATION_SECONDS);
});

test('MAX_DURATION_SECONDS matches the backend default cap, so a valid clip is never a 400', () => {
  const cfg = fs.readFileSync(new URL('../../backend/src/config/index.ts', import.meta.url), 'utf8');
  assert.match(cfg, new RegExp(`MAX_RECORDING_DURATION_SECONDS: .*default\\('${MAX_DURATION_SECONDS}'\\)`));
});

test('hasKnownDuration: null, undefined, 0 and garbage are unknown', () => {
  assert.equal(hasKnownDuration(45), true);
  for (const v of [null, undefined, 0, -1, NaN]) assert.equal(hasKnownDuration(v), false);
});

test('create body carries a sanitized duration_seconds and drops an invalid one', () => {
  const base = { title: 'T', file_name: 'a.webm', content_type: 'audio/webm', file_size: 10 };
  assert.equal(toCreateRecordingBody({ ...base, duration_seconds: 20.4 }).duration_seconds, 20);
  assert.equal('duration_seconds' in toCreateRecordingBody({ ...base, duration_seconds: 0 }), false);
  assert.equal('duration_seconds' in toCreateRecordingBody({ ...base, duration_seconds: Infinity }), false);
  assert.equal('duration_seconds' in toCreateRecordingBody({ ...base, duration_seconds: 99999999 }), false);
  assert.equal('duration_seconds' in toCreateRecordingBody(base), false);
});

test('contract: the backend create schema accepts duration_seconds', () => {
  const src = fs.readFileSync(new URL('../../backend/src/routes/recordings.ts', import.meta.url), 'utf8');
  const schema = src.slice(src.indexOf('const createRecordingSchema'), src.indexOf('const completeUploadSchema'));
  assert.match(schema, /duration_seconds: z\.number\(\)\.int\(\)/);
});

test('uploadWithPersistence sends the measured duration on create (and a retry from IndexedDB keeps it)', async () => {
  const seen = [];
  const deps = {
    create: async (req) => { seen.push(req); return { recordingId: 'r', uploadInfo: { url: 'u', method: 'PUT', headers: {} } }; },
    upload: async () => {},
    complete: async () => {},
  };
  const e = { id: 'p', title: 'T', blob: new Blob(['x']), fileName: 'a.webm', contentType: 'audio/webm', fileSize: 1, createdAt: 1 };
  await uploadWithPersistence(createMemoryStore(), { ...e, durationSeconds: 20 }, deps);
  await uploadWithPersistence(createMemoryStore(), e, deps);
  assert.equal(seen[0].duration_seconds, 20);
  assert.equal('duration_seconds' in seen[1], false);
});

test('RecordingClock: elapsed active time, pauses excluded, whole seconds', () => {
  const c = new RecordingClock();
  assert.equal(c.seconds(), 0);
  c.start(1_000);
  c.pause(11_000); // 10 s recorded
  c.resume(50_000); // 39 s paused, not counted
  c.stop(60_400); // + 10.4 s
  assert.equal(c.seconds(), 20);
  c.stop(70_000); // idempotent
  assert.equal(c.seconds(), 20);
});

test('RecordingClock: stop while paused counts only up to the pause; reset clears', () => {
  const c = new RecordingClock();
  c.start(0);
  c.pause(5_000);
  c.stop(99_000);
  assert.equal(c.seconds(), 5);
  c.reset();
  assert.equal(c.seconds(), 0);
});

function fakeAudioFactory({ duration, infiniteThenReal, never } = {}) {
  return () => {
    const l = {};
    const a = {
      preload: '',
      _duration: duration,
      get duration() { return this._duration; },
      set currentTime(v) { if (infiniteThenReal !== undefined) { this._duration = infiniteThenReal; queueMicrotask(() => l.timeupdate?.()); } },
      addEventListener(ev, fn) { l[ev] = fn; },
      removeEventListener(ev) { delete l[ev]; },
      removeAttribute() {},
      load() { if (!never) queueMicrotask(() => l.loadedmetadata?.()); },
      set src(_) {},
    };
    return a;
  };
}
const urlDeps = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };

test('readAudioDuration: reads a finite duration from the metadata', async () => {
  assert.equal(await readAudioDuration(new Blob(['x']), { ...urlDeps, createAudio: fakeAudioFactory({ duration: 44.7 }) }), 45);
});

test('readAudioDuration: MediaRecorder webm reports Infinity until seeked; the seek trick yields the real length', async () => {
  const d = await readAudioDuration(new Blob(['x']), { ...urlDeps, createAudio: fakeAudioFactory({ duration: Infinity, infiniteThenReal: 19.8 }) });
  assert.equal(d, 20);
});

test('readAudioDuration: unreadable or hanging metadata resolves undefined (never throws, never blocks the upload)', async () => {
  assert.equal(await readAudioDuration(new Blob(['x']), { ...urlDeps, createAudio: fakeAudioFactory({ duration: NaN }) }), undefined);
  assert.equal(await readAudioDuration(new Blob(['x']), { ...urlDeps, timeoutMs: 20, createAudio: fakeAudioFactory({ never: true }) }), undefined);
  assert.equal(await readAudioDuration(new Blob(['x']), { createObjectURL: () => { throw new Error('no'); }, revokeObjectURL() {}, createAudio: fakeAudioFactory({}) }), undefined);
});

test('contract: pages hide Length when the duration is unknown instead of printing 0:00', () => {
  const detail = fs.readFileSync(new URL('../src/app/(dashboard)/recordings/[id]/page.tsx', import.meta.url), 'utf8');
  const card = fs.readFileSync(new URL('../src/components/recordings/RecordingCard.tsx', import.meta.url), 'utf8');
  for (const [name, src] of [['detail page', detail], ['recording card', card]]) {
    assert.match(src, /hasKnownDuration\(recording\.duration_seconds\)/, `${name} must gate on hasKnownDuration`);
    assert.match(src, /\(isLive(Recording\(recording\))? \|\| hasKnownDuration\(recording\.duration_seconds\)\) &&/, `${name} must render the Length row only when live or known`);
  }
});
