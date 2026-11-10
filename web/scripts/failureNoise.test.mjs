// Which web errors the failure reporter drops. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isIgnorableWebFailure } from '../src/lib/failureNoise.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the Deno-runtime getReader rejection (2026-11-10, path /, 0 users) is dropped', () => {
  const text = "Cannot read properties of undefined (reading 'getReader')\nTypeError: Cannot read properties of undefined (reading 'getReader')\n    at N (<script>:2:17669)\n    at ext:core/01_core.js:294:9\n    at eventLoopTick (ext:core/01_core.js:178:7)";
  assert.equal(isIgnorableWebFailure(text), true);
  assert.equal(isIgnorableWebFailure('x\n    at node:internal/process/task_queues:95:5'), true);
});

test('crawler user agents are dropped, real browsers are not', () => {
  assert.equal(isIgnorableWebFailure('boom', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0 Safari/537.36'), true);
  assert.equal(isIgnorableWebFailure('boom', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'), false);
  assert.equal(isIgnorableWebFailure('boom'), false);
});

test('the old browser-noise list still applies and a genuine code error is still reported', () => {
  for (const t of ['Script error.', 'ResizeObserver loop limit exceeded', 'TypeError: Failed to fetch', 'Load failed', 'AbortError: x', 'at chrome-extension://abc/x.js:1:1']) {
    assert.equal(isIgnorableWebFailure(t), true, t);
  }
  assert.equal(isIgnorableWebFailure("TypeError: Cannot read properties of undefined (reading 'map')\n    at Page (https://meetingmind.org/_next/static/chunks/app/page.js:1:1)"), false);
});

test('WebFailureReporter uses the shared filter', () => {
  const src = readFileSync(path.join(here, '../src/components/WebFailureReporter.tsx'), 'utf8');
  assert.ok(src.includes('isIgnorableWebFailure('));
  assert.ok(!src.includes('const IGNORE'));
});
