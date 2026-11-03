// Tests for the per-meeting transcription language helpers. Run: npm test (Node >= 22.18 strips TypeScript types on import)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTO_LANGUAGE,
  TRANSCRIPTION_LANGUAGES,
  languageDisplayName,
  languageOptions,
  normalizeChoice,
  liveLanguageHelp,
  languageChoiceHint,
} from '../src/lib/transcriptionLanguages.ts';

const backend = readFileSync(new URL('../../backend/src/lib/transcriptionLanguage.ts', import.meta.url), 'utf8');
const backendCodes = [...backend.matchAll(/^\s*L\('([a-z]{2})', '([^']+)', '([^']+)'/gm)].map((m) => ({ code: m[1], name: m[2], native: m[3] }));

test('the picker offers exactly the languages the backend allow-list accepts (same codes, names, native names)', () => {
  assert.equal(backendCodes.length, 35);
  assert.deepEqual(TRANSCRIPTION_LANGUAGES.map((l) => l.code).sort(), backendCodes.map((l) => l.code).sort());
  for (const b of backendCodes) {
    const w = TRANSCRIPTION_LANGUAGES.find((l) => l.code === b.code);
    assert.equal(w.name, b.name, b.code);
    assert.equal(w.native, b.native, b.code);
  }
});

test('options start with Auto-detect, then every language by English name, labelled with the native name', () => {
  const opts = languageOptions();
  assert.equal(opts[0].value, AUTO_LANGUAGE);
  assert.equal(opts[0].label, 'Auto-detect');
  assert.equal(opts.length, 36);
  const names = opts.slice(1).map((o) => TRANSCRIPTION_LANGUAGES.find((l) => l.code === o.value).name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.equal(opts.find((o) => o.value === 'es').label, 'Español (Spanish)');
  assert.equal(opts.find((o) => o.value === 'en').label, 'English');
  assert.equal(opts.find((o) => o.value === 'ja').label, '日本語 (Japanese)');
});

test('display names', () => {
  assert.equal(languageDisplayName('auto'), 'Auto-detect');
  assert.equal(languageDisplayName(undefined), 'Auto-detect');
  assert.equal(languageDisplayName('fr'), 'Français (French)');
  assert.equal(languageDisplayName('zz'), 'Auto-detect');
});

test('normalizeChoice maps anything unknown to auto', () => {
  assert.equal(normalizeChoice('FR'), 'fr');
  assert.equal(normalizeChoice('zz'), 'auto');
  assert.equal(normalizeChoice(null), 'auto');
  assert.equal(normalizeChoice(''), 'auto');
});

const RECALL = { provider: 'recall', can_change_during_meeting: false, english_only_low_latency: true, non_english_live_delay_minutes: '3-10', auto_live_behaviour: 'english_low_latency' };
const SONIOX = { provider: 'soniox', can_change_during_meeting: true, english_only_low_latency: false, non_english_live_delay_minutes: null, auto_live_behaviour: 'detect' };

test('hint under the picker is honest about the Recall limits', () => {
  assert.match(languageChoiceHint('auto', RECALL), /English/);
  assert.match(languageChoiceHint('auto', RECALL), /final transcript/i);
  assert.match(languageChoiceHint('fr', RECALL), /3 to 10 minutes/);
  assert.equal(languageChoiceHint('en', RECALL), null);
  assert.equal(languageChoiceHint('fr', SONIOX), null);
  assert.equal(languageChoiceHint('auto', SONIOX), null);
  assert.equal(languageChoiceHint('fr', undefined), null);
});

test('live help explains why the control is disabled', () => {
  assert.equal(liveLanguageHelp({ can_change: true, reason: null }), null);
  assert.match(liveLanguageHelp({ can_change: false, reason: 'provider_fixed' }), /set when the bot joined/i);
  assert.match(liveLanguageHelp({ can_change: false, reason: 'provider_fixed' }), /final transcript/i);
  assert.match(liveLanguageHelp({ can_change: false, reason: 'not_live' }), /only while/i);
  assert.match(liveLanguageHelp(undefined), /only while/i);
});
