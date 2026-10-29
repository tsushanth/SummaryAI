// Unit tests for the pure feature-gate helpers. Run: npm run test:gates
// Node strips the TypeScript types on import (Node >= 22.18).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTabLocked,
  hasRecordingLimit,
  FREE_TIER_DEFAULT_FEATURES,
  LEGACY_FREE_RECORDING_LIMIT,
} from '../src/lib/featureGates.ts';

// What the backend returns today (FREE_TIER_LEGACY_LIMITS off) and under the old rules.
const freeNow = { ...FREE_TIER_DEFAULT_FEATURES };
const subscriber = Object.fromEntries(Object.keys(freeNow).map((k) => [k, true]));
const legacyFree = Object.fromEntries(Object.keys(freeNow).map((k) => [k, false]));

test('free user: Summary and Transcript are open, Q&A is locked', () => {
  assert.equal(isTabLocked('summary', freeNow), false);
  assert.equal(isTabLocked('transcript', freeNow), false);
  assert.equal(isTabLocked('qa', freeNow), true);
});

test('subscriber: nothing is locked', () => {
  for (const tab of ['summary', 'transcript', 'qa']) assert.equal(isTabLocked(tab, subscriber), false);
});

test('legacy mode (backend flag on): free user is locked out of Summary and Q&A again', () => {
  assert.equal(isTabLocked('summary', legacyFree), true);
  assert.equal(isTabLocked('qa', legacyFree), true);
  assert.equal(isTabLocked('transcript', legacyFree), false);
});

test('no lock badge while the subscription status is loading', () => {
  assert.equal(isTabLocked('qa', legacyFree, true), false);
  assert.equal(isTabLocked('summary', legacyFree, true), false);
});

test('recording limit applies only in legacy mode and never while loading', () => {
  assert.equal(hasRecordingLimit(freeNow), false);
  assert.equal(hasRecordingLimit(subscriber), false);
  assert.equal(hasRecordingLimit(legacyFree), true);
  assert.equal(hasRecordingLimit(legacyFree, true), false);
  assert.equal(LEGACY_FREE_RECORDING_LIMIT, 3);
});

test('defaults used when the status request fails keep summaries and recording free, Q&A paid', () => {
  assert.equal(FREE_TIER_DEFAULT_FEATURES.aiSummaries, true);
  assert.equal(FREE_TIER_DEFAULT_FEATURES.unlimitedRecordings, true);
  assert.equal(FREE_TIER_DEFAULT_FEATURES.qaChat, false);
  assert.equal(FREE_TIER_DEFAULT_FEATURES.meetingBot, false);
  assert.equal(FREE_TIER_DEFAULT_FEATURES.phoneRecording, false);
});
