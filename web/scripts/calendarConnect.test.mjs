// Starting a calendar sign-in. Run: node --test scripts/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { openCalendarSignIn, calendarConnectMessage, PopupBlockedError } from '../src/lib/calendarConnect.ts';

const fakeWindow = () => ({ location: { href: '' }, closed: false, close() { this.closed = true; } });

test('the window is opened before the server is asked, then sent to the sign-in page', async () => {
  const order = [];
  const win = fakeWindow();
  const popup = await openCalendarSignIn(
    () => { order.push('open'); return win; },
    async () => { order.push('ask'); return 'https://accounts.example/auth'; },
  );
  assert.deepEqual(order, ['open', 'ask']);
  assert.equal(popup.location.href, 'https://accounts.example/auth');
});

test('a blocked window is an error and starts no sign-in', async () => {
  let asked = false;
  await assert.rejects(openCalendarSignIn(() => null, async () => { asked = true; return 'x'; }), PopupBlockedError);
  assert.equal(asked, false);
});

test('a server failure closes the empty window and is passed on', async () => {
  const win = fakeWindow();
  const failure = new Error('down');
  await assert.rejects(openCalendarSignIn(() => win, async () => { throw failure; }), failure);
  assert.equal(win.closed, true);
});

test('the message says what the person can do', () => {
  assert.match(calendarConnectMessage(new PopupBlockedError()), /Allow pop-ups/);
  assert.equal(calendarConnectMessage({ name: 'ApiError', status: 422, message: 'Outlook calendar is not available yet.' }), 'Outlook calendar is not available yet.');
  assert.match(calendarConnectMessage({ name: 'ApiError', status: 502, message: 'Request failed with status 502' }), /try again/);
  assert.match(calendarConnectMessage(new TypeError('Failed to fetch')), /try again/);
});
