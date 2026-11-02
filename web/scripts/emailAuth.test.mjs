// Tests for the email/password sign-in helpers. Run: node --test scripts/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail, passwordProblem, safeNextPath, friendlyAuthError, resetRedirectUrl } from '../src/lib/emailAuth.ts';

test('email check accepts normal addresses and rejects obvious garbage', () => {
  for (const ok of ['a@b.co', ' user.name+tag@example.com ']) assert.equal(isValidEmail(ok), true, ok);
  for (const bad of ['', 'abc', 'a@b', '@b.com', 'a b@c.com', null, undefined]) assert.equal(isValidEmail(bad), false, String(bad));
});

test('new passwords need 8+ characters; sign-in does not re-validate length (Android accounts may be shorter)', () => {
  assert.equal(passwordProblem('1234567'), 'Use at least 8 characters.');
  assert.equal(passwordProblem(''), 'Enter a password.');
  assert.equal(passwordProblem('12345678'), null);
});

test('next path only allows same-site relative paths (no open redirect)', () => {
  assert.equal(safeNextPath('/auth/reset'), '/auth/reset');
  assert.equal(safeNextPath('/recordings?x=1'), '/recordings?x=1');
  for (const bad of ['https://evil.com', '//evil.com', 'javascript:alert(1)', '/\\evil.com', '', null, undefined, 'recordings']) {
    assert.equal(safeNextPath(bad), '/recordings', String(bad));
  }
  assert.equal(safeNextPath('//evil.com', '/auth'), '/auth');
});

test('reset link goes through the existing callback and lands on the new-password page', () => {
  const url = resetRedirectUrl('https://meetingmind.org');
  assert.equal(url, 'https://meetingmind.org/auth/callback?next=%2Fauth%2Freset');
});

test('provider messages become plain language', () => {
  assert.match(friendlyAuthError('Invalid login credentials'), /email or password/i);
  assert.match(friendlyAuthError('Email not confirmed'), /confirm/i);
  assert.match(friendlyAuthError('User already registered'), /already/i);
  assert.equal(friendlyAuthError('Something odd'), 'Something odd');
  assert.match(friendlyAuthError(undefined), /try again/i);
});
