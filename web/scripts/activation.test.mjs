// Tests for the activation-funnel helpers. Run: node --test scripts/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ACTIVATION_EVENT_NAMES, newAnonId, getOrCreateAnonId, isValidAnonId, parseUtm, rememberAttribution, attributionProps, buildEvent,
  trackingAllowed, shouldEmitOnce, observeRecordingsList, isFirstRecording, markFirstRecordingDone, isFreshSignup, summaryViewedState,
  ATTRIBUTION_KEY,
} from '../src/lib/activation.ts';

const fakeStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), m }; };

test('event allow-list matches the backend contract exactly', () => {
  const backend = fs.readFileSync(new URL('../../backend/src/services/activationEvents.ts', import.meta.url), 'utf8');
  const names = [...backend.match(/ACTIVATION_EVENT_NAMES = \[([\s\S]*?)\] as const/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...ACTIVATION_EVENT_NAMES], names);
});

test('anon ids are valid, stable per storage, and regenerated if storage holds junk', () => {
  const id = newAnonId();
  assert.equal(isValidAnonId(id), true);
  const s = fakeStore();
  const a = getOrCreateAnonId(s);
  assert.equal(getOrCreateAnonId(s), a);
  s.setItem('mm_act_anon', 'junk');
  assert.notEqual(getOrCreateAnonId(s), 'junk');
  assert.equal(isValidAnonId(getOrCreateAnonId(null)), true);
  assert.throws(() => newAnonId(() => 'x'));
});

test('parseUtm keeps short [a-z0-9._-] tags, drops injection, ignores own-host and bad referrers', () => {
  const a = parseUtm('?utm_source=Reddit&utm_medium=cpc&utm_campaign=Nov-1', 'https://News.Example.com/post?x=1', 'meetingmind.org', '/');
  assert.deepEqual(a, { utm_source: 'reddit', utm_medium: 'cpc', utm_campaign: 'nov-1', referrer_host: 'news.example.com', landing_path: '/' });
  assert.deepEqual(parseUtm('?utm_source=a%20b%3Bdrop&utm_medium=' + 'x'.repeat(200), 'https://meetingmind.org/auth', 'meetingmind.org', '/auth?x=1'), { utm_medium: 'x'.repeat(64) });
  assert.deepEqual(parseUtm('', '', 'meetingmind.org', ''), {});
  assert.deepEqual(parseUtm('', 'not a url', 'h', ''), {});
});

test('first touch wins and is stored in the session store', () => {
  const s = fakeStore();
  const first = rememberAttribution(s, { utm_source: 'reddit' });
  const later = rememberAttribution(s, { utm_source: 'google' });
  assert.deepEqual(first, { utm_source: 'reddit' });
  assert.deepEqual(later, { utm_source: 'reddit' });
  const empty = fakeStore();
  rememberAttribution(empty, {});
  assert.equal(empty.getItem(ATTRIBUTION_KEY), null);
});

test('attribution props are short enums only', () => {
  assert.deepEqual(attributionProps({ utm_source: 'reddit', referrer_host: 'a.b.com', landing_path: '/x', utm_campaign: 'y'.repeat(41) }), { utm_source: 'reddit', referrer_host: 'a.b.com' });
});

test('buildEvent enforces the allow-list and strips free text, objects and extra keys', () => {
  const id = newAnonId();
  assert.throws(() => buildEvent('purchase', id));
  assert.throws(() => buildEvent('landed', 'short'));
  const e = buildEvent('summary_viewed', id, { state: 'ok', n: 1.23456, flag: true, note: 'free text here', obj: { a: 1 }, 'Bad Key': 1 }, '1.0');
  assert.deepEqual(e, { anon_id: id, name: 'summary_viewed', props: { state: 'ok', n: 1.23, flag: true }, platform: 'web', app_version: '1.0' });
  const many = buildEvent('landed', id, Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i])));
  assert.equal(Object.keys(many.props).length, 8);
});

test('emission is off by default and honours Do Not Track and Global Privacy Control', () => {
  assert.equal(trackingAllowed({}), false);
  assert.equal(trackingAllowed({ flag: '0' }), false);
  assert.equal(trackingAllowed({ flag: '1' }), true);
  assert.equal(trackingAllowed({ flag: '1', doNotTrack: '1' }), false);
  assert.equal(trackingAllowed({ flag: '1', doNotTrack: 'yes' }), false);
  assert.equal(trackingAllowed({ flag: '1', gpc: true }), false);
  assert.equal(trackingAllowed({ flag: '1', doNotTrack: '0', gpc: false }), true);
});

test('shouldEmitOnce is true once per key', () => {
  const s = fakeStore();
  assert.equal(shouldEmitOnce(s, 'k'), true);
  assert.equal(shouldEmitOnce(s, 'k'), false);
  assert.equal(shouldEmitOnce(null, 'k'), true);
});

test('first-recording tracking: empty list marks it, a non-empty list or a finished recording clears it, filters are ignored', () => {
  const s = fakeStore();
  assert.equal(isFirstRecording(s), false);
  observeRecordingsList(s, 0, true);
  assert.equal(isFirstRecording(s), false);
  observeRecordingsList(s, 0, false);
  assert.equal(isFirstRecording(s), true);
  markFirstRecordingDone(s);
  observeRecordingsList(s, 0, false); // stays cleared: an account that already recorded once is not "first" again
  assert.equal(isFirstRecording(s), false);
  const t = fakeStore();
  observeRecordingsList(t, 0, false);
  observeRecordingsList(t, 3, false);
  assert.equal(isFirstRecording(t), false);
  assert.equal(isFirstRecording(null), false);
});

test('a signup counts as fresh for 15 minutes', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  assert.equal(isFreshSignup('2026-11-03T11:50:00Z', now), true);
  assert.equal(isFreshSignup('2026-11-03T11:30:00Z', now), false);
  assert.equal(isFreshSignup(undefined, now), false);
  assert.equal(isFreshSignup('garbage', now), false);
});

test('summary_viewed state maps the summary tab kinds', () => {
  assert.equal(summaryViewedState('summary'), 'ok');
  assert.equal(summaryViewedState('too_short'), 'too_short');
  assert.equal(summaryViewedState('no_speech'), 'no_speech');
  assert.equal(summaryViewedState('processing'), null);
  assert.equal(summaryViewedState('failed_upload'), null);
});

test('the build flag is not set in fly.toml (default OFF)', () => {
  assert.equal(/NEXT_PUBLIC_ACTIVATION_EVENTS/.test(fs.readFileSync(new URL('../fly.toml', import.meta.url), 'utf8')), false);
});
