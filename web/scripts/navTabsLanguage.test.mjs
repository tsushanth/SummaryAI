// Tests for sidebar items, recording-type filters and summary output languages.
// Run: node --test scripts/*.test.mjs  (Node strips TypeScript types on import, Node >= 22.18)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NAV_ITEMS } from '../src/lib/navItems.ts';
import { PHONE_CALLS_ENABLED, isSwitchedOffPath } from '../src/lib/features.ts';
import { filtersToParams } from '../src/lib/recordingFilters.ts';
import { recordingsQueryString } from '../src/lib/recordingsQuery.ts';
import { OUTPUT_LANGUAGES, outputLanguageParam } from '../src/lib/outputLanguages.ts';

test('phone calls are switched off', () => {
  assert.equal(PHONE_CALLS_ENABLED, false);
});

test('Phone is not in the sidebar while phone calls are off', () => {
  assert.deepEqual(NAV_ITEMS.map((n) => n.href), ['/recordings', '/search', '/chat', '/meetings', '/todos', '/settings']);
});

test('the phone pages are redirected while phone calls are off, and only those', () => {
  for (const path of ['/phone', '/phone/', '/phone/settings']) assert.equal(isSwitchedOffPath(path), true, path);
  for (const path of ['/', '/recordings', '/phones', '/phone-help', '/share/phone', '/settings']) {
    assert.equal(isSwitchedOffPath(path), false, path);
  }
  assert.equal(isSwitchedOffPath('/phone', true), false, 'switching the flag back on opens the pages again');
});

test('the middleware redirects switched-off pages before anything else needs a session', () => {
  const mw = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8');
  const gate = mw.indexOf('isSwitchedOffPath(request.nextUrl.pathname)');
  assert.ok(gate > 0, 'middleware does not call isSwitchedOffPath');
  assert.ok(gate < mw.indexOf('createServerClient('), 'the redirect must not depend on Supabase');
});

test('every sidebar page is protected by the auth middleware', () => {
  const mw = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8');
  for (const { href } of NAV_ITEMS) {
    assert.ok(mw.includes(`startsWith('${href}')`), `middleware does not protect ${href}`);
  }
});

test('sidebar names and hrefs are unique', () => {
  assert.equal(new Set(NAV_ITEMS.map((n) => n.href)).size, NAV_ITEMS.length);
  assert.equal(new Set(NAV_ITEMS.map((n) => n.name)).size, NAV_ITEMS.length);
});

test('the Meetings and Imported tabs map to the recording_type API param (same values as Android)', () => {
  assert.deepEqual(filtersToParams({ recordingType: 'meeting' }), { recording_type: 'meeting' });
  assert.deepEqual(filtersToParams({ recordingType: 'imported' }), { recording_type: 'imported' });
  assert.deepEqual(filtersToParams({}), {});
});

test('type tab combines with the other filters', () => {
  const p = filtersToParams({ recordingType: 'meeting', favorite: true, folderId: 'f1', tag: 'x' });
  assert.deepEqual(p, { recording_type: 'meeting', favorite: true, folder_id: 'f1', tag: 'x' });
});

test('date range still produces a from timestamp', () => {
  assert.match(filtersToParams({ range: '7d' }).from, /^\d{4}-\d\d-\d\dT/);
});

test('recording_type is sent in the list query string', () => {
  assert.equal(recordingsQueryString({ recording_type: 'imported' }), 'recording_type=imported');
  assert.equal(recordingsQueryString({ per_page: 50, recording_type: 'meeting' }), 'per_page=50&recording_type=meeting');
  assert.equal(recordingsQueryString({}), '');
  assert.equal(recordingsQueryString({ favorite: false }), 'favorite=false');
});

test('output languages are all supported by the backend prompt map, and unique', () => {
  const src = readFileSync(new URL('../../backend/src/lib/outputLanguage.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('const LANGUAGE_NAMES'));
  const mapBlock = fn.slice(0, fn.indexOf('};'));
  const backendCodes = [...mapBlock.matchAll(/^\s*([a-z]{2}):/gm)].map((m) => m[1]);
  assert.ok(backendCodes.length >= 10, 'could not parse the backend language map');
  for (const { code } of OUTPUT_LANGUAGES) {
    assert.ok(backendCodes.includes(code), `backend does not know ${code}`);
  }
  assert.equal(new Set(OUTPUT_LANGUAGES.map((l) => l.code)).size, OUTPUT_LANGUAGES.length);
});

test('"same as the recording" sends no output_language; a chosen language is sent as its code', () => {
  assert.equal(outputLanguageParam(''), undefined);
  assert.equal(outputLanguageParam(undefined), undefined);
  assert.equal(outputLanguageParam('fr'), 'fr');
  assert.equal(outputLanguageParam('xx'), undefined); // not in the supported list
});
