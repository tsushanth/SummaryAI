'use client';

import useSWR from 'swr';
import {
  getSubscriptionStatus,
  getSubscriptionPrices,
  createCheckoutSession,
  createPortalSession,
  SubscriptionStatus,
  SubscriptionPrice,
} from '@/lib/api/subscription';
import { useState, useCallback } from 'react';

/**
 * Hook to get and manage subscription status
 */
export function useSubscription() {
  const { data, error, isLoading, mutate } = useSWR<SubscriptionStatus>(
    'subscription-status',
    getSubscriptionStatus,
    {
      revalidateOnFocus: true,
      refreshInterval: 60000, // Refresh every minute
    }
  );

  const isSubscribed = data?.isSubscribed ?? false;
  const isPremium =
    data?.status === 'active' || data?.status === 'trialing';

  return {
    subscription: data,
    isSubscribed,
    isPremium,
    status: data?.status ?? 'free',
    plan: data?.plan,
    provider: data?.provider,
    expiresAt: data?.expiresAt,
    features: data?.features ?? {
      unlimitedRecordings: false,
      aiSummaries: false,
      qaChat: false,
      meetingBot: false,
      phoneRecording: false,
      calendarSync: false,
      exportPdf: false,
    },
    isLoading,
    error,
    refresh: mutate,
  };
}

/**
 * Hook to get subscription prices
 */
export function useSubscriptionPrices() {
  const { data, error, isLoading } = useSWR<{ prices: SubscriptionPrice[] }>(
    'subscription-prices',
    getSubscriptionPrices,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // Cache for 1 minute
    }
  );

  return {
    prices: data?.prices ?? [],
    isLoading,
    error,
  };
}

/**
 * Hook to handle checkout flow
 */
export function useCheckout() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = useCallback(
    async (planType: 'weekly' | 'monthly' | 'yearly') => {
      setIsLoading(true);
      setError(null);

      try {
        const { checkoutUrl } = await createCheckoutSession(planType);
        // Redirect to Stripe checkout
        window.location.href = checkoutUrl;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to start checkout';
        setError(message);
        setIsLoading(false);
      }
    },
    []
  );

  return {
    startCheckout,
    isLoading,
    error,
  };
}

/**
 * Hook to open customer portal
 */
export function useCustomerPortal() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { portalUrl } = await createPortalSession();
      // Open portal in new tab
      window.open(portalUrl, '_blank');
      setIsLoading(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to open portal';
      setError(message);
      setIsLoading(false);
    }
  }, []);

  return {
    openPortal,
    isLoading,
    error,
  };
}
