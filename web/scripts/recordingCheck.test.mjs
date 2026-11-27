// A browser recording or audio file that is too short or silent is held back before upload. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LevelMeter, MIN_SECONDS, SILENT_PEAK, DECODE_MAX_BYTES, DECODE_MAX_SECONDS, canDecode, checkAudioFile, checkMicRecording,
  peakOf, readFileAudio, recordingCheckText, startLevelSampling,
} from '../src/lib/recordingCheck.ts';
import { submitBlockedReason } from '../src/lib/newRecordingForm.ts';

const window_ = (peak, n = 16) => Float32Array.from({ length: n }, (_, i) => (i === 3 ? -peak : 0));

test('the limits are the Android app\'s', () => {
  const kotlin = readFileSync(new URL('../../android/app/src/main/java/com/kreativekoala/summaryai/service/RecordingCheck.kt', import.meta.url), 'utf8');
  assert.equal(MIN_SECONDS, Number(kotlin.match(/MIN_SECONDS = (\d+)/)[1]));
  assert.equal(SILENT_PEAK, Number(kotlin.match(/SILENT_PEAK = (\d+)/)[1]) / 32767);
});

test('a recording under 10 seconds is held for certain; a silent one can still be sent', () => {
  assert.deepEqual(checkMicRecording(9, 0.5), { problem: 'too_short', seconds: 9, canUploadAnyway: false });
  assert.deepEqual(checkMicRecording(0, null), { problem: 'too_short', seconds: 0, canUploadAnyway: false });
  assert.deepEqual(checkMicRecording(60, 0.001), { problem: 'silent', seconds: 60, canUploadAnyway: true });
  assert.deepEqual(checkMicRecording(60, 0), { problem: 'silent', seconds: 60, canUploadAnyway: true });
  assert.equal(checkMicRecording(10, SILENT_PEAK), null);
  assert.equal(checkMicRecording(60, 0.4), null);
  assert.equal(checkMicRecording(60, null), null, 'a level that could not be judged never holds a recording');
});

test('level meter: silence only after listening to enough of the recording', () => {
  const m = new LevelMeter();
  assert.equal(m.peak(20), null, 'nothing read');
  for (let t = 0; t <= 20_000; t += 250) m.add(window_(0.001), 680, t);
  assert.ok(Math.abs(m.peak(20) - 0.001) < 1e-6);
});

test('level meter: slow timers still judge, very slow ones do not, and heard sound always counts', () => {
  const hidden = new LevelMeter();
  for (let t = 0; t <= 60_000; t += 1000) hidden.add(window_(0), 680, t);
  assert.equal(hidden.peak(60), 0);
  const frozen = new LevelMeter();
  for (let t = 0; t <= 600_000; t += 60_000) frozen.add(window_(0), 680, t);
  assert.equal(frozen.peak(600), null);
  frozen.add(window_(0.3), 680, 601_000);
  assert.ok(Math.abs(frozen.peak(600) - 0.3) < 1e-6);
});

test('level meter: a pause is not counted as listened time', () => {
  const m = new LevelMeter();
  m.add(window_(0), 680, 0);
  m.pause();
  m.add(window_(0), 680, 100_000);
  assert.equal(m.peak(10), null);
});

function fakeContext({ state = 'running', peak = 0 } = {}) {
  const calls = { closed: 0, resumed: 0, disconnected: 0 };
  return {
    calls, state, sampleRate: 48000,
    resume: async () => { calls.resumed++; },
    close: async () => { calls.closed++; },
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => { calls.disconnected++; } }),
    createAnalyser: () => ({ fftSize: 0, getFloatTimeDomainData: (into) => { into.fill(0); into[7] = peak; } }),
  };
}

test('sampling reads only while recording, in a running context, and closes once', () => {
  let t = 0;
  let recording = true;
  const meter = new LevelMeter();
  const ctx = fakeContext({ peak: 0.2 });
  const s = startLevelSampling(ctx, {}, meter, () => recording, () => (t += 400));
  s.sampleNow(); s.sampleNow();
  assert.ok(Math.abs(meter.peak(1) - 0.2) < 1e-6);
  recording = false;
  s.sampleNow();
  s.stop(); s.stop(); s.sampleNow();
  assert.equal(ctx.calls.closed, 1);
  assert.equal(ctx.calls.disconnected, 1);
  assert.equal(ctx.calls.resumed, 1);

  const suspended = new LevelMeter();
  const s2 = startLevelSampling(fakeContext({ state: 'suspended' }), {}, suspended, () => true);
  s2.sampleNow(); s2.sampleNow(); s2.sampleNow();
  assert.equal(suspended.peak(1), null, 'a context that never ran must not look like silence');
  s2.stop();
});

test('sampling without Web Audio, or with a broken one, leaves silence unjudged', () => {
  const meter = new LevelMeter();
  startLevelSampling(null, {}, meter, () => true).sampleNow();
  const broken = { ...fakeContext(), createAnalyser: () => { throw new Error('no'); } };
  startLevelSampling(broken, {}, meter, () => true).sampleNow();
  assert.equal(meter.peak(100), null);
});

test('files: certain when decoded, otherwise the user may send anyway', () => {
  assert.deepEqual(checkAudioFile({ seconds: 4, exact: true, peak: 0.5 }), { problem: 'too_short', seconds: 4, canUploadAnyway: false });
  assert.deepEqual(checkAudioFile({ seconds: 4, exact: false, peak: null }), { problem: 'too_short', seconds: 4, canUploadAnyway: true });
  assert.deepEqual(checkAudioFile({ seconds: 60, exact: true, peak: 0 }), { problem: 'silent', seconds: 60, canUploadAnyway: true });
  assert.equal(checkAudioFile({ seconds: 60, exact: true, peak: 0.5 }), null);
  assert.equal(checkAudioFile({ seconds: undefined, exact: false, peak: null }), null, 'nothing known, nothing held');
});

const audio = (duration, ...channels) => ({ duration, numberOfChannels: channels.length, getChannelData: (c) => channels[c] });
const blob = (size) => ({ size, arrayBuffer: async () => new ArrayBuffer(4) });

test('peakOf looks at every channel', () => {
  assert.equal(peakOf(audio(1, [0, 0], [0, -0.5])), 0.5);
  assert.equal(peakOf(audio(1, [0, 0.001])), 0.001);
});

test('readFileAudio: decodes short files and never rejects', async () => {
  const deps = { readDuration: async () => 30, decode: async () => audio(30.2, [0, 0]) };
  assert.deepEqual(await readFileAudio(blob(1000), deps), { seconds: 30.2, exact: true, peak: 0 });
  const failing = { readDuration: async () => 5, decode: async () => { throw new Error('codec'); } };
  assert.deepEqual(await readFileAudio(blob(1000), failing), { seconds: 5, exact: false, peak: null });
  const unreadable = { readDuration: async () => { throw new Error('x'); }, decode: async () => { throw new Error('x'); } };
  assert.deepEqual(await readFileAudio(blob(1000), unreadable), { seconds: undefined, exact: false, peak: null });
  const hanging = { readDuration: async () => 30, decode: () => new Promise(() => {}), timeoutMs: 5 };
  assert.deepEqual(await readFileAudio(blob(1000), hanging), { seconds: 30, exact: false, peak: null });
});

test('readFileAudio: a partial decode is not believed', async () => {
  const deps = { readDuration: async () => 600, decode: async () => audio(2, [0]) };
  const got = await readFileAudio(blob(1000), deps);
  assert.deepEqual(got, { seconds: 600, exact: false, peak: null });
  assert.equal(checkAudioFile(got), null);
});

test('long or large files are not decoded', async () => {
  assert.equal(canDecode(DECODE_MAX_BYTES, DECODE_MAX_SECONDS), true);
  assert.equal(canDecode(DECODE_MAX_BYTES + 1, 60), false);
  assert.equal(canDecode(1000, DECODE_MAX_SECONDS + 1), false);
  assert.equal(canDecode(6 * 1024 * 1024, undefined), false);
  let decoded = 0;
  await readFileAudio(blob(DECODE_MAX_BYTES + 1), { readDuration: async () => 3600, decode: async () => { decoded++; return audio(1, [0]); } });
  assert.equal(decoded, 0);
});

test('every held case says why and offers only what is possible', () => {
  const short = recordingCheckText({ problem: 'too_short', seconds: 3, canUploadAnyway: false }, 'recording', true);
  assert.match(short.message, /under 10 seconds are not uploaded\. Keep going/);
  assert.doesNotMatch(short.message, /upload it anyway/);
  const silent = recordingCheckText({ problem: 'silent', seconds: 30, canUploadAnyway: true }, 'recording', false);
  assert.match(silent.message, /kept in this browser\. Record again[\s\S]*upload it anyway/);
  assert.doesNotMatch(silent.message, /Keep going/);
  const unsaved = recordingCheckText({ problem: 'silent', seconds: 30, canUploadAnyway: true }, 'recording', false, false);
  assert.match(unsaved.message, /could not save a copy, so keep this page open/);
  assert.doesNotMatch(unsaved.message, /kept in this browser/);
  assert.match(recordingCheckText({ problem: 'silent', seconds: 30, canUploadAnyway: true }, 'file').message, /upload it anyway/);
  assert.match(recordingCheckText({ problem: 'too_short', seconds: 3, canUploadAnyway: false }, 'file').message, /Choose a longer file/);
  assert.match(recordingCheckText({ problem: 'too_short', seconds: 3, canUploadAnyway: true }, 'file').message, /upload it anyway/);
});

test('the disabled button says why', () => {
  const base = { mode: 'record', hasAudio: false, isRecording: true, isSubmitting: false };
  assert.match(submitBlockedReason({ ...base, held: true }), /Choose what to do/);
  assert.match(submitBlockedReason({ ...base, mode: 'upload', hasAudio: true, isRecording: false, held: true }), /not uploaded/);
  assert.match(submitBlockedReason({ ...base, mode: 'upload', hasAudio: true, checking: true }), /Checking/);
});

test('the page stops, submits and shows the notice through the check', () => {
  const page = readFileSync(new URL('../src/app/(dashboard)/recordings/new/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /onStop=\{handleStop\}/);
  assert.doesNotMatch(page, /onStop=\{recorder\.stopRecording\}/);
  assert.match(page, /mode === 'record' && !recordingApprovedRef\.current[\s\S]{0,200}checkMicRecording/);
  assert.match(page, /source="recording"/);
  assert.match(page, /source="file"/);
  assert.match(page, /canSubmit = hasAudio && !isSubmitting && !held && !checking/);
});

const source = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('a recording held as silent is finished and saved; only a very short one stays paused', () => {
  const page = source('app/(dashboard)/recordings/new/page.tsx');
  assert.match(page, /if \(held\?\.problem === 'too_short'\) recorder\.pauseRecording\(\);\s*else recorder\.stopRecording\(\);/);
});

test('nothing that was not uploaded is thrown away without asking', () => {
  const page = source('app/(dashboard)/recordings/new/page.tsx');
  assert.match(page, /const recordAgain = async \(\) => \{\s*if \(!window\.confirm\(DISCARD_QUESTION\)\) return;/);
  assert.match(page, /if \(recorder\.audioBlob && !window\.confirm\(DISCARD_QUESTION\)\) return;/);
  assert.equal(page.match(/recorder\.restartRecording\(\)/g).length, 1, 'only Record again restarts');
});

test('the recorder looks at MediaRecorder.state and finishes the recording in onstop', () => {
  const hook = source('hooks/useAudioRecorder.ts');
  assert.match(hook, /recorder\?\.state !== 'recording'\) return;/);
  assert.match(hook, /recorder\?\.state !== 'paused'\) return;/);
  assert.match(hook, /if \(recorder\.state !== 'inactive'\) recorder\.stop\(\);/);
  assert.match(hook, /mediaRecorder\.onstop = \(\) => \{[\s\S]*?isRecording: false,\s*isPaused: false,[\s\S]*?audioBlob: blob/);
});
