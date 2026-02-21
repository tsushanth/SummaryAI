/**
 * Ad Optimizer Service Integration
 * Forwards subscription events to the ad-optimizer service for LTV tracking
 */

import { config } from '../config/index.js';

interface AdOptimizerEvent {
  event_type: 'started' | 'renewed' | 'canceled' | 'refunded';
  external_user_id: string;
  revenue?: number;
  currency?: string;
  plan?: 'weekly' | 'monthly' | 'yearly';
  attribution?: {
    network?: string;
    campaign_id?: string;
    campaign_name?: string;
    ad_group_id?: string;
    ad_group_name?: string;
    keyword_id?: string;
    keyword?: string;
    match_type?: string;
  };
  attribution_raw?: Record<string, unknown>;
}

/**
 * Forward a subscription event to the ad-optimizer service
 * This is fire-and-forget - we don't want to block the main webhook processing
 */
export async function forwardSubscriptionEvent(event: AdOptimizerEvent): Promise<void> {
  const adOptimizerUrl = config.AD_OPTIMIZER_URL;
  const adOptimizerProductId = config.AD_OPTIMIZER_PRODUCT_ID;
  const adOptimizerApiKey = config.AD_OPTIMIZER_API_KEY;

  // Skip if not configured
  if (!adOptimizerUrl || !adOptimizerProductId || !adOptimizerApiKey) {
    return;
  }

  try {
    const response = await fetch(
      `${adOptimizerUrl}/webhooks/events/${adOptimizerProductId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adOptimizerApiKey}`,
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      console.error(
        `[Ad Optimizer] Failed to forward event: ${response.status} ${response.statusText}`
      );
    } else {
      console.log(`[Ad Optimizer] Forwarded ${event.event_type} event for user ${event.external_user_id}`);
    }
  } catch (error) {
    // Log but don't throw - this should not block the main flow
    console.error('[Ad Optimizer] Error forwarding event:', error);
  }
}

/**
 * Helper to build attribution object from Apple Search Ads data
 */
export function buildAttributionFromASA(adsData: {
  attribution?: boolean;
  campaignId?: number;
  campaignName?: string;
  adGroupId?: number;
  adGroupName?: string;
  keywordId?: number;
  keyword?: string;
  matchType?: string;
}): AdOptimizerEvent['attribution'] | undefined {
  if (!adsData?.attribution) {
    return undefined;
  }

  return {
    network: 'apple_search_ads',
    campaign_id: adsData.campaignId?.toString(),
    campaign_name: adsData.campaignName,
    ad_group_id: adsData.adGroupId?.toString(),
    ad_group_name: adsData.adGroupName,
    keyword_id: adsData.keywordId?.toString(),
    keyword: adsData.keyword,
    match_type: adsData.matchType,
  };
}

/**
 * Map RevenueCat event type to our simplified event type
 */
export function mapRevenueCatEventType(
  rcEventType: string
): AdOptimizerEvent['event_type'] | null {
  switch (rcEventType) {
    case 'INITIAL_PURCHASE':
      return 'started';
    case 'RENEWAL':
    case 'UNCANCELLATION':
      return 'renewed';
    case 'CANCELLATION':
    case 'EXPIRATION':
      return 'canceled';
    case 'REFUND':
      return 'refunded';
    default:
      return null;
  }
}

/**
 * Get estimated revenue from plan type
 * This is a rough estimate - actual revenue comes from RevenueCat/Stripe
 */
export function getEstimatedRevenue(planType: string): number {
  switch (planType) {
    case 'weekly':
      return 4.89; // Approximate after Apple's cut
    case 'monthly':
      return 10.49;
    case 'yearly':
      return 48.99;
    default:
      return 10.49; // Default to monthly
  }
}
