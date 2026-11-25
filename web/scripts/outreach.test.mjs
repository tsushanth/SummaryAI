// Tests for the outreach first-touch helpers. Run: node --test scripts/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOutreachParams, captureOutreachTouch, getSignupSource, clearOutreachTouch, sendOutreachAttribution, isNewAccount,
  OUTREACH_STORAGE_KEY, OUTREACH_TTL_MS,
} from '../src/lib/outreach.ts';
import { parseUtm, attributionProps } from '../src/lib/activation.ts';

const fakeStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), raw: m };
};
const T0 = 1_800_000_000_000;
const LINK = '?utm_source=outreach&utm_medium=email&utm_campaign=nz-pilot-1&utm_content=Ab_9-x';
const FRESH = new Date(T0 - 3600_000).toISOString();

test('parseOutreachParams keeps only source, campaign and code, and only for outreach links', () => {
  assert.deepEqual(parseOutreachParams(LINK), { utm_source: 'outreach', utm_campaign: 'nz-pilot-1', utm_content: 'Ab_9-x' });
  assert.deepEqual(parseOutreachParams('?utm_source=Outreach&utm_campaign=NZ-1'), { utm_source: 'outreach', utm_campaign: 'nz-1' });
  for (const bad of ['?utm_source=google&utm_campaign=x', '?utm_campaign=x', '', '?utm_source=outreach', '?utm_source=outreach&utm_campaign=bad%20value', '?utm_source=outreach&utm_campaign=' + 'a'.repeat(65)]) {
    assert.equal(parseOutreachParams(bad), null, bad);
  }
  assert.deepEqual(parseOutreachParams('?utm_source=outreach&utm_campaign=c1&utm_content=' + encodeURIComponent('<script>')), { utm_source: 'outreach', utm_campaign: 'c1' });
});

test('stores an outreach link and returns it without the timestamp', () => {
  const s = fakeStorage();
  assert.equal(captureOutreachTouch(LINK, s, T0), true);
  assert.deepEqual(getSignupSource(s, T0 + 1000), { utm_source: 'outreach', utm_campaign: 'nz-pilot-1', utm_content: 'Ab_9-x' });
  assert.deepEqual(Object.keys(JSON.parse(s.raw.get(OUTREACH_STORAGE_KEY))).sort(), ['ts', 'utm_campaign', 'utm_content', 'utm_source']);
});

test('first touch wins while unexpired; an expired one is replaced after 30 days', () => {
  const s = fakeStorage();
  captureOutreachTouch('?utm_source=outreach&utm_campaign=first&utm_content=a', s, T0);
  assert.equal(captureOutreachTouch('?utm_source=outreach&utm_campaign=second&utm_content=b', s, T0 + 5 * 86400_000), false);
  assert.equal(getSignupSource(s, T0 + 6 * 86400_000).utm_campaign, 'first');
  const later = T0 + OUTREACH_TTL_MS + 1000;
  assert.equal(getSignupSource(s, later), undefined);
  assert.equal(captureOutreachTouch('?utm_source=outreach&utm_campaign=second&utm_content=b', s, later), true);
  assert.equal(getSignupSource(s, later).utm_campaign, 'second');
});

test('non-outreach visits store nothing and leave a stored touch alone', () => {
  const s = fakeStorage();
  assert.equal(captureOutreachTouch('?utm_source=newsletter&utm_campaign=x', s, T0), false);
  assert.equal(s.raw.size, 0);
  captureOutreachTouch(LINK, s, T0);
  assert.equal(captureOutreachTouch('?q=1', s, T0 + 1), false);
  assert.ok(getSignupSource(s, T0 + 2));
});

test('corrupt storage is ignored; storage that throws or is missing never breaks the page', () => {
  for (const bad of ['not json', '{"ts":"x"}', JSON.stringify({ ts: T0, utm_source: 'outreach', utm_campaign: 'BAD CAMPAIGN' })]) {
    assert.equal(getSignupSource(fakeStorage({ [OUTREACH_STORAGE_KEY]: bad }), T0), undefined, bad);
  }
  const boom = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(captureOutreachTouch(LINK, boom, T0), false);
  assert.equal(getSignupSource(boom, T0), undefined);
  assert.doesNotThrow(() => clearOutreachTouch(boom));
  assert.equal(captureOutreachTouch(LINK, null, T0), false);
});

test('isNewAccount accepts the last 7 days only', () => {
  assert.equal(isNewAccount(FRESH, T0), true);
  assert.equal(isNewAccount(new Date(T0 - 8 * 86400_000).toISOString(), T0), false);
  assert.equal(isNewAccount(undefined, T0), false);
  assert.equal(isNewAccount('garbage', T0), false);
});

test('sendOutreachAttribution posts the three fields plus platform once, then forgets the touch', async () => {
  const s = fakeStorage();
  captureOutreachTouch(LINK, s, T0);
  const calls = [];
  const post = async (b) => void calls.push(b);
  assert.equal(await sendOutreachAttribution(post, FRESH, s, T0 + 10), 'sent');
  assert.deepEqual(calls, [{ utm_source: 'outreach', utm_campaign: 'nz-pilot-1', utm_content: 'Ab_9-x', platform: 'web' }]);
  assert.equal(await sendOutreachAttribution(post, FRESH, s, T0 + 20), 'none');
  assert.equal(calls.length, 1);
});

test('sendOutreachAttribution: no touch sends nothing; an old account drops the touch unsent; a failed post keeps it', async () => {
  const s = fakeStorage();
  const calls = [];
  const post = async (b) => void calls.push(b);
  assert.equal(await sendOutreachAttribution(post, FRESH, s, T0), 'none');
  captureOutreachTouch(LINK, s, T0);
  assert.equal(await sendOutreachAttribution(post, new Date(T0 - 30 * 86400_000).toISOString(), s, T0 + 5), 'old_account');
  assert.equal(calls.length, 0);
  assert.equal(getSignupSource(s, T0 + 6), undefined);
  captureOutreachTouch(LINK, s, T0);
  assert.equal(await sendOutreachAttribution(async () => { throw new Error('net'); }, FRESH, s, T0 + 10), 'failed');
  assert.ok(getSignupSource(s, T0 + 11));
});

test('the existing activation attribution carries utm_content for outreach links only, with its case, and not as an event prop', () => {
  assert.equal(parseUtm(LINK, '', 'meetingmind.org', '/').utm_content, 'Ab_9-x');
  assert.equal(parseUtm('?utm_source=google&utm_content=Zed', '', 'meetingmind.org', '/').utm_content, undefined);
  assert.equal(parseUtm('?utm_source=outreach&utm_content=%3Cx%3E', '', 'meetingmind.org', '/').utm_content, undefined);
  assert.equal('utm_content' in attributionProps(parseUtm(LINK, '', 'meetingmind.org', '/')), false);
});
