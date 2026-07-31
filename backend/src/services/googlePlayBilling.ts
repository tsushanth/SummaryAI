/**
 * Minimal Google Play Developer API client for verifying coaching subscription
 * purchases. Uses the `listenai@summaryai-483115.iam.gserviceaccount.com`
 * service account credentials from env var GOOGLE_PLAY_SA_JSON.
 *
 * Only the subscriptionsv2.get endpoint is wired — that's all we need to
 * confirm an Android purchase token is valid before granting coaching credits.
 */

import { GoogleAuth } from 'google-auth-library';

const PACKAGE_NAME = 'com.kreativekoala.meetingmind';

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
};

let cachedAuth: GoogleAuth | null = null;

function loadAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;
  const raw = process.env.GOOGLE_PLAY_SA_JSON;
  if (!raw) throw new Error('GOOGLE_PLAY_SA_JSON not configured');
  const credentials: ServiceAccountKey = JSON.parse(raw);
  cachedAuth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  return cachedAuth;
}

export type SubscriptionPurchaseV2 = {
  kind?: string;
  regionCode?: string;
  lineItems?: Array<{
    productId: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
  }>;
  startTime?: string;
  subscriptionState?:
    | 'SUBSCRIPTION_STATE_UNSPECIFIED'
    | 'SUBSCRIPTION_STATE_PENDING'
    | 'SUBSCRIPTION_STATE_ACTIVE'
    | 'SUBSCRIPTION_STATE_PAUSED'
    | 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
    | 'SUBSCRIPTION_STATE_ON_HOLD'
    | 'SUBSCRIPTION_STATE_CANCELED'
    | 'SUBSCRIPTION_STATE_EXPIRED';
  latestOrderId?: string;
  linkedPurchaseToken?: string;
  acknowledgementState?: 'ACKNOWLEDGEMENT_STATE_UNSPECIFIED' | 'ACKNOWLEDGEMENT_STATE_PENDING' | 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
};

/**
 * Look up a subscription purchase via the v2 endpoint.
 *
 * Returns the full SubscriptionPurchaseV2 response; caller checks
 * `subscriptionState` and `lineItems[*].productId`.
 *
 * Throws on 4xx/5xx so the caller can surface the failure.
 */
export async function getSubscriptionPurchase(purchaseToken: string): Promise<SubscriptionPurchaseV2> {
  const auth = loadAuth();
  const client = await auth.getClient();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
    PACKAGE_NAME
  )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const { data } = await client.request<SubscriptionPurchaseV2>({ url, method: 'GET' });
  return data;
}

/**
 * Acknowledge a subscription purchase. Required within 3 days or Google refunds
 * the user automatically. The Android client also acknowledges via BillingClient,
 * but we belt-and-suspenders here in case the client never gets to call it.
 */
export async function acknowledgeSubscription(productId: string, purchaseToken: string): Promise<void> {
  const auth = loadAuth();
  const client = await auth.getClient();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
    PACKAGE_NAME
  )}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  await client.request({ url, method: 'POST', data: {} });
}
