'use client';

import useSWR from 'swr';
import {
  getSubscriptionStatus,
  createPortalSession,
  SubscriptionStatus,
} from '@/lib/api/subscription';
import { useState, useCallback } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { hasStripeSubscription } from '@/lib/billing';

/**
 * Billing status for the signed-in user. MeetingMind is free, so this is only used to find out whether the
 * user still has a Stripe subscription to manage (see `hasStripeBilling`); nothing in the UI is gated on it.
 */
export function useSubscription() {
  const { user, loading: authLoading } = useAuth();

  // Only fetch when user is authenticated (use null key to disable fetching)
  const { data, error, isLoading, mutate } = useSWR<SubscriptionStatus>(
    user ? 'subscription-status' : null,
    getSubscriptionStatus,
    {
      revalidateOnFocus: true,
      refreshInterval: 60000, // Refresh every minute
    }
  );

  return {
    subscription: data,
    hasStripeBilling: hasStripeSubscription(data),
    status: data?.status ?? 'free',
    plan: data?.plan,
    provider: data?.provider,
    expiresAt: data?.expiresAt,
    isLoading: authLoading || isLoading,
    error,
    refresh: mutate,
  };
}

/**
 * Hook to open the Stripe customer portal (for people who subscribed on the web before MeetingMind became free)
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
