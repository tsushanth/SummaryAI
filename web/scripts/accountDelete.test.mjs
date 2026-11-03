// Unit tests for the delete-account helpers. Run: node --test scripts/*.test.mjs
// Node strips the TypeScript types on import (Node >= 22.18).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELETE_CONFIRM_WORD,
  isDeleteConfirmed,
  hasBillableStripeSubscription,
  deleteAccountThenSignOut,
} from '../src/lib/accountDelete.ts';

test('only the exact confirmation word (ignoring surrounding spaces) enables the button', () => {
  assert.equal(DELETE_CONFIRM_WORD, 'DELETE');
  assert.equal(isDeleteConfirmed('DELETE'), true);
  assert.equal(isDeleteConfirmed('  DELETE \n'), true);
  for (const bad of ['', 'delete', 'Delete', 'DELET', 'DELETE ME', 'DELETED', undefined, null]) {
    assert.equal(isDeleteConfirmed(bad), false, String(bad));
  }
});

test('a billable Stripe subscription is flagged so the user is warned it is not cancelled for them', () => {
  assert.equal(hasBillableStripeSubscription({ provider: 'stripe', status: 'active' }), true);
  assert.equal(hasBillableStripeSubscription({ provider: 'stripe', status: 'trialing' }), true);
  assert.equal(hasBillableStripeSubscription({ provider: 'stripe', status: 'past_due' }), true);
  assert.equal(hasBillableStripeSubscription({ provider: 'stripe', status: 'canceled' }), false);
  assert.equal(hasBillableStripeSubscription({ provider: 'play_store', status: 'active' }), false);
  assert.equal(hasBillableStripeSubscription(undefined), false);
});

test('success: deletes first, then signs out', async () => {
  const calls = [];
  const r = await deleteAccountThenSignOut({
    remove: async () => calls.push('remove'),
    signOut: async () => calls.push('signOut'),
  });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls, ['remove', 'signOut']);
});

test('failure: reports the error and does NOT sign the user out', async () => {
  let signedOut = false;
  const r = await deleteAccountThenSignOut({
    remove: async () => {
      throw new Error('Failed to delete account: boom');
    },
    signOut: async () => {
      signedOut = true;
    },
  });
  assert.deepEqual(r, { ok: false, message: 'Failed to delete account: boom' });
  assert.equal(signedOut, false);
});

test('the auth user is already gone after a successful delete, so a sign-out error is ignored', async () => {
  const r = await deleteAccountThenSignOut({
    remove: async () => {},
    signOut: async () => {
      throw new Error('User from sub claim in JWT does not exist');
    },
  });
  assert.deepEqual(r, { ok: true });
});

test('non-Error rejections get a readable message', async () => {
  const r = await deleteAccountThenSignOut({ remove: () => Promise.reject('x'), signOut: async () => {} });
  assert.deepEqual(r, { ok: false, message: 'Failed to delete account' });
});
