// The "add a meeting by link" form: Zoom link warnings, default time. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomLinkWarning, getDefaultDateTime, ZOOM_BROWSER_LINK_WARNING, ZOOM_NO_PASSCODE_WARNING } from '../src/lib/meetingLink.ts';

test('a Zoom web-client link warns, with or without a passcode', () => {
  for (const url of ['https://app.zoom.us/wc/12345678901', 'https://app.zoom.us/wc/join/12345678901?pwd=abc', 'https://us05web.zoom.us/wc/12345678901/start']) {
    assert.equal(zoomLinkWarning(url), ZOOM_BROWSER_LINK_WARNING, url);
  }
});

test('a Zoom link without pwd= warns', () => {
  for (const url of ['https://zoom.us/j/12345678901', 'https://us02web.zoom.us/j/1?pwd=', 'https://company.zoom.com/my/room', 'https://x.zoomgov.com/j/1']) {
    assert.equal(zoomLinkWarning(url), ZOOM_NO_PASSCODE_WARNING, url);
  }
});

test('invite links, other platforms, look-alike hosts and non-URLs do not warn', () => {
  for (const url of ['https://us05web.zoom.us/j/12345678901?pwd=AbC.1', 'https://meet.google.com/abc-defg-hij', 'https://notzoom.us/j/1', 'https://zoom.us.example.com/j/1', 'zoom']) {
    assert.equal(zoomLinkWarning(url), null, url);
  }
});

test('the default is the next quarter hour from the given moment, rolling over the hour and the day', () => {
  assert.deepEqual(getDefaultDateTime(new Date(2026, 10, 23, 18, 32, 15)), { date: '2026-11-23', time: '18:45' });
  assert.deepEqual(getDefaultDateTime(new Date(2026, 10, 23, 23, 50)), { date: '2026-11-24', time: '00:00' });
});

test('it does not modify the date it is given', () => {
  const now = new Date(2026, 10, 23, 18, 32);
  getDefaultDateTime(now);
  assert.equal(now.getMinutes(), 32);
});
