// Unit tests for the billing-portal visibility rule. Run: npm test
// Node strips the TypeScript types on import (Node >= 22.18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasStripeSubscription } from '../src/lib/billing.ts';

test('web (Stripe) subscribers who can still be billed see the billing page', () => {
  for (const status of ['active', 'trialing', 'past_due']) {
    assert.equal(hasStripeSubscription({ provider: 'stripe', status }), true, status);
  }
});

test('free users never see a billing surface', () => {
  assert.equal(hasStripeSubscription({ provider: null, status: 'free' }), false);
  assert.equal(hasStripeSubscription({ status: 'free' }), false);
  assert.equal(hasStripeSubscription(undefined), false);
  assert.equal(hasStripeSubscription(null), false);
});

test('ended Stripe subscriptions have nothing left to manage', () => {
  for (const status of ['canceled', 'expired', 'free']) {
    assert.equal(hasStripeSubscription({ provider: 'stripe', status }), false, status);
  }
});

test('store subscribers (Play / App Store) are not sent to the Stripe portal', () => {
  assert.equal(hasStripeSubscription({ provider: 'play_store', status: 'active' }), false);
  assert.equal(hasStripeSubscription({ provider: 'app_store', status: 'active' }), false);
});

test('missing status is treated as no subscription', () => {
  assert.equal(hasStripeSubscription({ provider: 'stripe', status: null }), false);
  assert.equal(hasStripeSubscription({ provider: 'stripe' }), false);
});
