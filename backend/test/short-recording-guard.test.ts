// Pure rules for "is there enough audio to summarise": thresholds, reasons, API fields, env overrides.
import { describe, it, expect } from 'vitest';
import {
  evaluateSummaryEligibility,
  summaryStateFor,
  countSpeechUnits,
  TOO_SHORT_CODE,
  NO_SPEECH_CODE,
} from '../src/services/shortRecordingGuard.js';
import { getRecordingLimits, DEFAULT_RECORDING_LIMITS } from '../src/config/recordingLimits.js';

const L = DEFAULT_RECORDING_LIMITS;

describe('recording limits config', () => {
  it('defaults: 30 s, 25 words, dense 60 words, 6 h', () => {
    expect(getRecordingLimits({})).toEqual({ minSummarySeconds: 30, minSummaryWords: 25, denseWords: 60, abandonedUploadHours: 6 });
  });
  it('is env-overridable and ignores junk values', () => {
    expect(getRecordingLimits({ MIN_SUMMARY_SECONDS: '45', MIN_SUMMARY_WORDS: '40', DENSE_WORDS: '90', ABANDONED_UPLOAD_HOURS: '2' }))
      .toEqual({ minSummarySeconds: 45, minSummaryWords: 40, denseWords: 90, abandonedUploadHours: 2 });
    expect(getRecordingLimits({ MIN_SUMMARY_SECONDS: 'abc', MIN_SUMMARY_WORDS: '-3', DENSE_WORDS: 'x', ABANDONED_UPLOAD_HOURS: '' }))
      .toEqual(DEFAULT_RECORDING_LIMITS);
  });
  it('0 is a valid override (turns that rule off)', () => {
    expect(getRecordingLimits({ MIN_SUMMARY_SECONDS: '0', MIN_SUMMARY_WORDS: '0' }))
      .toMatchObject({ minSummarySeconds: 0, minSummaryWords: 0 });
  });
});

describe('evaluateSummaryEligibility', () => {
  const ok = (durationSeconds: number | null, wordCount: number) =>
    evaluateSummaryEligibility({ durationSeconds, wordCount, isDocument: false }, L);

  it('zero words is no_speech', () => {
    expect(ok(120, 0)).toMatchObject({ eligible: false, reason: 'no_speech', code: NO_SPEECH_CODE });
    expect(ok(null, 0)).toMatchObject({ eligible: false, reason: 'no_speech' });
  });
  it('short AND thin is too_short: a 10 s clip with 20 words, a 29 s clip with 59 words', () => {
    expect(ok(10, 20)).toMatchObject({ eligible: false, reason: 'too_short', code: TOO_SHORT_CODE });
    expect(ok(29, 59)).toMatchObject({ eligible: false, reason: 'too_short' });
    expect(ok(12.4, 30)).toMatchObject({ eligible: false, reason: 'too_short' });
  });
  it('short but dense is summarised: 25 s with 80 words, 29 s with exactly 60 words', () => {
    expect(ok(25, 80)).toEqual({ eligible: true });
    expect(ok(29, 60)).toEqual({ eligible: true });
  });
  it('under 25 words is too_short whatever the length, even a very dense-looking short clip rule cannot save it', () => {
    expect(ok(600, 24)).toMatchObject({ eligible: false, reason: 'too_short' });
    expect(ok(600, 1)).toMatchObject({ eligible: false, reason: 'too_short' });
    expect(ok(5, 24)).toMatchObject({ eligible: false, reason: 'too_short' });
  });
  it('30 s or longer with 25+ words is eligible (boundaries inclusive)', () => {
    expect(ok(30, 25)).toEqual({ eligible: true });
    expect(ok(29, 25)).toMatchObject({ eligible: false });
    expect(ok(30, 25)).toEqual({ eligible: true });
  });
  it('unknown / zero duration falls back to the word rule alone', () => {
    expect(ok(null, 80)).toEqual({ eligible: true });
    expect(ok(0, 80)).toEqual({ eligible: true });
    expect(ok(null, 10)).toMatchObject({ eligible: false, reason: 'too_short' });
  });
  it('documents (PDF imports) are never gated', () => {
    expect(evaluateSummaryEligibility({ durationSeconds: null, wordCount: 3, isDocument: true }, L)).toEqual({ eligible: true });
    expect(evaluateSummaryEligibility({ durationSeconds: null, wordCount: 0, isDocument: true }, L)).toEqual({ eligible: true });
  });
  it('the message asks for a little more', () => {
    const r = evaluateSummaryEligibility({ durationSeconds: 5, wordCount: 3, isDocument: false }, L);
    expect(r).toMatchObject({ eligible: false, message: 'Too short to summarize. Say a little more, or upload audio.' });
  });
  it('limits are configurable: dense threshold 90 makes 29 s / 80 words too short', () => {
    expect(evaluateSummaryEligibility({ durationSeconds: 29, wordCount: 80, isDocument: false }, { ...L, denseWords: 90 }))
      .toMatchObject({ eligible: false });
  });
  it('rules set to 0 are off', () => {
    expect(evaluateSummaryEligibility({ durationSeconds: 3, wordCount: 5, isDocument: false }, { ...L, minSummarySeconds: 0, minSummaryWords: 0 }))
      .toEqual({ eligible: true });
  });
});

describe('countSpeechUnits (unspaced scripts must not look "too short")', () => {
  it('counts whitespace words for spaced languages', () => {
    expect(countSpeechUnits('hello there  general kenobi')).toBe(4);
    expect(countSpeechUnits('')).toBe(0);
    expect(countSpeechUnits('   ')).toBe(0);
  });
  it('counts roughly 2 characters per unit for Chinese / Japanese / Thai, which Deepgram returns without spaces', () => {
    expect(countSpeechUnits('今天我们讨论一下第三季度的目标和进展情况')).toBeGreaterThanOrEqual(8);
    expect(countSpeechUnits('今日は会議を始めます')).toBeGreaterThanOrEqual(4);
    expect(countSpeechUnits('สวัสดีครับวันนี้เราจะคุยกัน')).toBeGreaterThanOrEqual(5);
  });
  it('mixed text adds both', () => {
    expect(countSpeechUnits('ok 今天开会')).toBe(1 + 2);
  });
});

describe('summaryStateFor (additive API fields)', () => {
  it('completed + TOO_SHORT and no summary row', () => {
    const s = summaryStateFor({ status: 'completed', error_code: 'TOO_SHORT' }, false, L);
    expect(s.summary_status).toBe('too_short');
    expect(s.summary_message).toBe('Too short to summarize. Say a little more, or upload audio.');
    expect(s.summary_min_seconds).toBe(30);
  });
  it('completed + NO_SPEECH', () => {
    const s = summaryStateFor({ status: 'completed', error_code: 'NO_SPEECH' }, false, L);
    expect(s.summary_status).toBe('no_speech');
    expect(s.summary_message).toMatch(/speech/i);
  });
  it('a summary row wins (user regenerated a short one): ready, no message', () => {
    expect(summaryStateFor({ status: 'completed', error_code: 'TOO_SHORT' }, true, L))
      .toEqual({ summary_status: 'ready', summary_message: null, summary_min_seconds: 30 });
  });
  it('normal completed recording is ready', () => {
    expect(summaryStateFor({ status: 'completed', error_code: null }, true, L).summary_status).toBe('ready');
  });
  it('processing statuses', () => {
    for (const status of ['uploaded', 'transcribing', 'transcribed', 'summarizing']) {
      expect(summaryStateFor({ status, error_code: null }, false, L).summary_status).toBe('processing');
    }
  });
  it('abandoned upload and other failures', () => {
    expect(summaryStateFor({ status: 'failed', error_code: 'FAILED_UPLOAD' }, false, L).summary_status).toBe('failed_upload');
    expect(summaryStateFor({ status: 'failed', error_code: 'PROCESSING_ERROR' }, false, L).summary_status).toBe('failed');
  });
  it('completed without a summary and without a code (legacy rows) is unavailable, not too_short', () => {
    expect(summaryStateFor({ status: 'completed', error_code: null }, false, L).summary_status).toBe('unavailable');
  });
});
