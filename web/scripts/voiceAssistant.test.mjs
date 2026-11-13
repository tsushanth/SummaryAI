// Tests for the in-meeting voice assistant switch helpers. Run: npm test (Node >= 22.18 strips TypeScript types on import)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { switchOn, saveVoiceAssistant } from '../src/lib/voiceAssistant.ts';

test('switch follows the saved choice, else the server rollout', () => {
  assert.equal(switchOn({ enabled: true, reason: 'enabled', preference: null, mode: 'all' }), true);
  assert.equal(switchOn({ enabled: false, reason: 'user_opted_out', preference: false, mode: 'all' }), false);
  assert.equal(switchOn({ enabled: true, reason: 'enabled', preference: true, mode: 'opt_in' }), true);
  assert.equal(switchOn({ enabled: false, reason: 'not_opted_in', preference: null, mode: 'opt_in' }), false);
  assert.equal(switchOn({ enabled: false, reason: 'mode_off', preference: null, mode: 'off' }), false);
  // a kill switch does not erase the user's own choice
  assert.equal(switchOn({ enabled: false, reason: 'killed', preference: true, mode: 'all' }), true);
  assert.equal(switchOn(null), false);
  assert.equal(switchOn(undefined), false);
  assert.equal(switchOn({}), false);
});

test('save: flips at once, keeps the value the server stored', async () => {
  const seen = [];
  const sent = [];
  const r = await saveVoiceAssistant(true, false, async (v) => { sent.push(v); return { preference: false }; }, (c) => seen.push(c));
  assert.deepEqual(sent, [false]);
  assert.deepEqual(seen, [false]);
  assert.deepEqual(r, { checked: false, failed: false });
});

test('save: a failed request rolls the switch back and reports the failure, without throwing', async () => {
  const seen = [];
  const r = await saveVoiceAssistant(true, false, async () => { throw new Error('offline'); }, (c) => seen.push(c));
  assert.deepEqual(seen, [false, true]);
  assert.deepEqual(r, { checked: true, failed: true });
});

test('save: same value makes no call', async () => {
  let calls = 0;
  const r = await saveVoiceAssistant(true, true, async () => { calls++; return {}; }, () => {});
  assert.equal(calls, 0);
  assert.deepEqual(r, { checked: true, failed: false });
});

test('save: an empty OK body keeps what was asked for', async () => {
  const r = await saveVoiceAssistant(false, true, async () => ({}), () => {});
  assert.deepEqual(r, { checked: true, failed: false });
});

test('wording matches Android and the API path/body match the backend route', () => {
  const card = readFileSync(new URL('../src/components/settings/VoiceAssistantCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /Voice assistant in meetings/);
  assert.match(card, /When on, the meeting bot answers questions out loud when someone says 'Meeting Mind, \.\.\.'\. Turn off to keep the bot silent\./);
  const api = readFileSync(new URL('../src/lib/api/voiceAssistant.ts', import.meta.url), 'utf8');
  assert.match(api, /'\/api\/voice-assistant'/);
  assert.match(api, /method: 'PUT'/);
  assert.match(api, /JSON\.stringify\(\{ enabled \}\)/);
});
