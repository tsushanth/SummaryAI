import { apiClient } from './client';

export interface SubscriptionStatus {
  isSubscribed: boolean;
  status: 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
  plan: 'weekly' | 'monthly' | 'yearly' | null;
  provider: 'stripe' | 'app_store' | 'play_store' | null;
  expiresAt: string | null;
  subscribedAt: string | null;
  features: {
    unlimitedRecordings: boolean;
    aiSummaries: boolean;
    qaChat: boolean;
    meetingBot: boolean;
    phoneRecording: boolean;
    calendarSync: boolean;
    exportPdf: boolean;
  };
}

export interface SubscriptionPrice {
  planType: 'weekly' | 'monthly' | 'yearly';
  price: number;
  currency: string;
  interval: string;
  displayPrice: string;
  savingsVsAppStore: string;
  appStorePrice: string;
  trialDays?: number;
  highlighted?: boolean;
  monthlyEquivalent?: string;
}

export interface CheckoutResponse {
  checkoutUrl: string;
  sessionId: string;
}

export interface PortalResponse {
  portalUrl: string;
}

export interface PricesResponse {
  prices: SubscriptionPrice[];
}

/**
 * Get current subscription status
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  return apiClient<SubscriptionStatus>('/api/subscriptions/status');
}

/**
 * Create a Stripe checkout session
 */
export async function createCheckoutSession(
  planType: 'weekly' | 'monthly' | 'yearly'
): Promise<CheckoutResponse> {
  return apiClient<CheckoutResponse>('/api/subscriptions/checkout', {
    method: 'POST',
    body: JSON.stringify({ planType }),
  });
}

/**
 * Create a Stripe customer portal session
 */
export async function createPortalSession(): Promise<PortalResponse> {
  return apiClient<PortalResponse>('/api/subscriptions/portal', {
    method: 'POST',
  });
}

/**
 * Get available subscription prices
 */
export async function getSubscriptionPrices(): Promise<PricesResponse> {
  return apiClient<PricesResponse>('/api/subscriptions/prices');
}
