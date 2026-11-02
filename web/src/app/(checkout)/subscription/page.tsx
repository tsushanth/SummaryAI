'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useSubscription, useCustomerPortal } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';

/**
 * MeetingMind is free, so there is nothing to buy here. This page remains only as the billing-portal entry for
 * people who subscribed on the web (Stripe) before it became free, so they can cancel or fix a card.
 * Everyone else is sent on to the app (or to sign in).
 */
export default function SubscriptionPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { hasStripeBilling, expiresAt, status, isLoading } = useSubscription();
  const { openPortal, isLoading: portalLoading, error } = useCustomerPortal();

  const settled = !authLoading && !isLoading;

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/auth');
    } else if (settled && !hasStripeBilling) {
      router.replace('/recordings');
    }
  }, [authLoading, user, settled, hasStripeBilling, router]);

  if (!settled || !user || !hasStripeBilling) {
    return (
      <div className="mx-auto flex min-h-[400px] max-w-lg items-center justify-center px-4 py-6">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="mb-2 text-2xl font-bold text-foreground">Billing</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        MeetingMind is free for everyone, with every feature included, so you no longer need a paid plan. Your earlier
        web subscription is still active and keeps billing through Stripe until you cancel it.
      </p>
      {expiresAt && (
        <p className="mb-4 text-sm text-muted-foreground">
          {status === 'trialing' ? 'Trial ends' : 'Current period ends'} {new Date(expiresAt).toLocaleDateString()}.
        </p>
      )}
      <Button variant="outline" onClick={openPortal} disabled={portalLoading}>
        {portalLoading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        Manage or cancel subscription
      </Button>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}
