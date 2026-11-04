// Unit test for the "No recordings yet" empty-state copy on the recordings page. Run: npm test
// page.tsx is a client component (JSX), so we assert on its source text rather than importing it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pagePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/app/(dashboard)/recordings/page.tsx',
);
const source = readFileSync(pagePath, 'utf8');

test('"No recordings yet" empty state tells new users a short recording is enough', () => {
  const titleIndex = source.indexOf('title="No recordings yet"');
  assert.notEqual(titleIndex, -1, 'expected the "No recordings yet" EmptyState to exist');

  const messageMatch = source.slice(titleIndex).match(/message="([^"]*)"/);
  assert.ok(messageMatch, 'expected a message prop on the "No recordings yet" EmptyState');
  assert.match(
    messageMatch[1],
    /A one-minute recording is enough to see your first summary\.$/,
    'expected the message to end with the one-minute-recording sentence',
  );
});
