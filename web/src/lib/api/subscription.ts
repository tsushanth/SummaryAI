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

export interface PortalResponse {
  portalUrl: string;
}

/**
 * Get current subscription status
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  return apiClient<SubscriptionStatus>('/api/subscriptions/status');
}

/**
 * Create a Stripe customer portal session
 */
export async function createPortalSession(): Promise<PortalResponse> {
  return apiClient<PortalResponse>('/api/subscriptions/portal', {
    method: 'POST',
  });
}
