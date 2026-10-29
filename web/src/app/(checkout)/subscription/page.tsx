'use client';

import { useCheckout } from '@/hooks/useSubscription';
import { useAuth } from '@/components/auth/AuthProvider';
import { Check, Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, Suspense } from 'react';

const plans = [
  {
    id: 'yearly',
    name: 'Annual',
    price: '$48.99',
    period: '/year',
    perWeek: '$0.94/week',
    appStorePrice: '$69.99',
    badge: 'Best Value',
    trial: '7-day free trial',
  },
  {
    id: 'monthly',
    name: 'Monthly',
    price: '$10.49',
    period: '/month',
    perWeek: '$2.62/week',
    appStorePrice: '$14.99',
    badge: null,
    trial: null,
  },
  {
    id: 'weekly',
    name: 'Weekly',
    price: '$4.89',
    period: '/week',
    perWeek: '$4.89/week',
    appStorePrice: '$6.99',
    badge: null,
    trial: null,
  },
];

function SubscriptionContent() {
  const { user, loading: authLoading } = useAuth();
  const { startCheckout, isLoading: checkoutLoading, error: checkoutError } = useCheckout();
  const searchParams = useSearchParams();
  const autoCheckoutTriggered = useRef(false);

  // Auto-trigger checkout if user is logged in and plan param is present
  // This handles the return from auth flow
  useEffect(() => {
    const planParam = searchParams.get('plan');
    const validPlans = ['weekly', 'monthly', 'yearly'];

    // Only auto-checkout if:
    // - We have a valid plan param
    // - User is logged in
    // - Not already loading
    // - Haven't already triggered (prevent double checkout)
    if (
      planParam &&
      validPlans.includes(planParam) &&
      user &&
      !authLoading &&
      !checkoutLoading &&
      !autoCheckoutTriggered.current
    ) {
      autoCheckoutTriggered.current = true;
      startCheckout(planParam as 'weekly' | 'monthly' | 'yearly');
    }
  }, [user, authLoading, checkoutLoading, searchParams, startCheckout]);

  const handleSelect = (planId: string) => {
    startCheckout(planId as 'weekly' | 'monthly' | 'yearly');
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Unlock Pro Features
        </h1>
        <p className="text-muted-foreground text-sm">
          Save 30% vs App Store prices
        </p>
      </div>

      {/* Plans */}
      <div className="space-y-3 mb-6">
        {plans.map((plan) => (
          <button
            key={plan.id}
            onClick={() => handleSelect(plan.id)}
            disabled={checkoutLoading}
            className="w-full text-left p-4 rounded-xl border-2 border-border hover:border-primary transition-colors disabled:opacity-50 relative"
          >
            {plan.badge && (
              <span className="absolute -top-2.5 left-4 bg-amber-600 text-white text-xs font-bold px-2 py-0.5 rounded">
                {plan.badge}
              </span>
            )}

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{plan.name}</span>
                  {plan.trial && (
                    <span className="text-xs text-success font-medium">
                      {plan.trial}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <span className="line-through">{plan.appStorePrice}</span>
                  <span className="text-success ml-1">Save 30%</span>
                </div>
              </div>

              <div className="text-right">
                <div className="font-bold text-foreground">
                  {plan.price}
                  <span className="text-sm font-normal text-muted-foreground">{plan.period}</span>
                </div>
                <div className="text-xs text-success font-medium">
                  {plan.perWeek}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Features */}
      <div className="bg-muted rounded-xl p-4 mb-6">
        <p className="font-medium text-foreground text-sm mb-1">All plans include:</p>
        <p className="text-xs text-muted-foreground mb-3">Recording, transcripts and summaries are free for everyone.</p>
        <div className="grid grid-cols-1 gap-2">
          {[
            'Q&A chat with recordings',
            'Meeting bot (Zoom, Teams, Meet)',
            'Phone call recording',
          ].map((feature) => (
            <div key={feature} className="flex items-center gap-2 text-sm text-foreground/90">
              <Check className="w-4 h-4 text-success flex-shrink-0" />
              {feature}
            </div>
          ))}
        </div>
      </div>

      {/* Loading indicator */}
      {checkoutLoading && (
        <div className="flex items-center justify-center gap-2 text-primary mb-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">
            {authLoading ? 'Loading...' : user ? 'Redirecting to checkout...' : 'Redirecting to sign in...'}
          </span>
        </div>
      )}

      {/* Error message */}
      {checkoutError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 mb-4">
          <p className="text-destructive text-sm text-center">{checkoutError}</p>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-muted-foreground space-y-1">
        <p>Secure payment powered by Stripe</p>
        <p>Cancel anytime. No commitment.</p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <a href="https://kreativekoala.llc/terms" className="hover:text-foreground">Terms</a>
          <span>·</span>
          <a href="https://kreativekoala.llc/privacy" className="hover:text-foreground">Privacy</a>
        </div>
      </div>
    </div>
  );
}

function SubscriptionLoading() {
  return (
    <div className="max-w-lg mx-auto px-4 py-6 flex items-center justify-center min-h-[400px]">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}

export default function SubscriptionPage() {
  return (
    <Suspense fallback={<SubscriptionLoading />}>
      <SubscriptionContent />
    </Suspense>
  );
}
