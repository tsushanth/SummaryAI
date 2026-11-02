// Guards the public marketing surface against claims we cannot back up (see docs/legal/privacy-policy-draft-2026-11.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = {
  'landing page': readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8'),
  'web llms.txt': readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8'),
  'root llms.txt': readFileSync(new URL('../../llms.txt', import.meta.url), 'utf8'),
};

const banned = [
  [/github\.com\/tsushanth\/SummaryAI\/releases/i, 'desktop download link (the repo has no releases)'],
  [/\bmac(os)?\b/i, 'Mac / macOS client (none is downloadable)'],
  [/\bwindows\b/i, 'Windows client (none is downloadable)'],
  [/desktop client/i, 'desktop clients'],
  [/apps\.apple\.com/i, 'App Store link (Android only)'],
  [/\b(ios|iphone|ipad)\b/i, 'iOS mention (Android only)'],
  [/no bot|botless|invisible|silent(ly)?\b/i, 'claims the product records without a visible bot'],
  [/(does not|doesn't|never) train/i, 'a no-training claim (not verified with Deepgram or Anthropic)'],
  [/\bunlimited\b/i, 'bare "unlimited" (fair use and per-file limits apply)'],
];

for (const [name, text] of Object.entries(files)) {
  for (const [re, why] of banned) {
    test(`${name}: no ${why}`, () => {
      assert.ok(!re.test(text), `${name} matches ${re}: ${why}`);
    });
  }
}

test('landing page lists only Android and Browser as platforms', () => {
  const block = files['landing page'].split('const PLATFORMS = [')[1].split('];')[0];
  const names = [...block.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(names, ['Android', 'Browser']);
});
