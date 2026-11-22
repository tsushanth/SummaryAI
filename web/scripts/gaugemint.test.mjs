// The Gaugemint tag belongs on the public landing page only. The root layout is shared with /share/[token]
// (secret in the URL) and the dashboard, so it must never load there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SRC = 'https://guagemint.com/js/script.js';

test('landing page loads the Gaugemint tag with the meetingmind.org domain', () => {
  const page = read('../src/app/page.tsx');
  assert.ok(page.includes(SRC));
  assert.match(page, /data-domain="meetingmind\.org"/);
  assert.match(page, /strategy="afterInteractive"/);
});

test('no other source file loads Gaugemint (the admin embed validator only names the host)', () => {
  const root = new URL('../src/', import.meta.url);
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?|mjs)$/.test(e.name) && /guagemint\.com/i.test(readFileSync(full, 'utf8'))) hits.push(full.pathname);
    }
  };
  walk(root);
  // The admin embed validator (src/lib/gaugemintEmbed.ts) names the host to allow-list it; it loads nothing.
  const loaders = hits.filter((h) => !h.endsWith('/src/lib/gaugemintEmbed.ts'));
  assert.equal(loaders.length, 1, `expected only the landing page, got ${hits}`);
  assert.ok(loaders[0].endsWith('/src/app/page.tsx'));
  assert.ok(!/js\/script/.test(read('../src/lib/gaugemintEmbed.ts')), 'the validator must not reference the tag script');
});
