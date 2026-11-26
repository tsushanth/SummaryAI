// A browser-recorded webm reports an Infinity length; the player must not print "Infinity:NaN:NaN".
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from '../src/lib/utils/audio.ts';

test('formatDuration never prints Infinity or NaN', () => {
  assert.equal(formatDuration(Infinity), '0:00');
  assert.equal(formatDuration(NaN), '0:00');
  assert.equal(formatDuration(47), '0:47');
  assert.equal(formatDuration(3723), '1:02:03');
});
