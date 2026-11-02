/**
 * MeetingMind is free for everyone: there is no upgrade path on the web. The only billing surface left is the
 * Stripe customer portal, for people who subscribed on the web before it became free and still need to cancel
 * or update their card. Keep this file free of runtime imports so node can load it directly (see
 * scripts/billing.test.mjs).
 */

export interface BillingStatus {
  status?: string | null;
  provider?: string | null;
}

/** Stripe states in which a customer may still be billed (or be asked to fix a payment). */
const BILLABLE_STATUSES = ['active', 'trialing', 'past_due'];

/** True when the user has a Stripe subscription that the customer portal can manage. */
export function hasStripeSubscription(sub: BillingStatus | null | undefined): boolean {
  if (!sub) return false;
  return sub.provider === 'stripe' && !!sub.status && BILLABLE_STATUSES.includes(sub.status);
}
