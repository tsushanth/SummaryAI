'use client';

import { useCheckout } from '@/hooks/useSubscription';
import { useAuth } from '@/components/auth/AuthProvider';
import { Check, Loader2 } from 'lucide-react';

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

export default function SubscriptionPage() {
  const { user, loading: authLoading } = useAuth();
  const { startCheckout, isLoading: checkoutLoading, error: checkoutError } = useCheckout();

  const handleSelect = (planId: string) => {
    startCheckout(planId as 'weekly' | 'monthly' | 'yearly');
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Unlock Pro Features
        </h1>
        <p className="text-gray-600 text-sm">
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
            className="w-full text-left p-4 rounded-xl border-2 border-gray-200 hover:border-blue-500 transition-colors disabled:opacity-50 relative"
          >
            {plan.badge && (
              <span className="absolute -top-2.5 left-4 bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded">
                {plan.badge}
              </span>
            )}

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{plan.name}</span>
                  {plan.trial && (
                    <span className="text-xs text-green-600 font-medium">
                      {plan.trial}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  <span className="line-through">{plan.appStorePrice}</span>
                  <span className="text-green-600 ml-1">Save 30%</span>
                </div>
              </div>

              <div className="text-right">
                <div className="font-bold text-gray-900">
                  {plan.price}
                  <span className="text-sm font-normal text-gray-500">{plan.period}</span>
                </div>
                <div className="text-xs text-green-600 font-medium">
                  {plan.perWeek}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Features */}
      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <p className="font-medium text-gray-900 text-sm mb-3">All plans include:</p>
        <div className="grid grid-cols-1 gap-2">
          {[
            'Unlimited recordings',
            'AI transcription & summaries',
            'Q&A chat with recordings',
            'Meeting bot (Zoom, Teams, Meet)',
            'Phone call recording',
          ].map((feature) => (
            <div key={feature} className="flex items-center gap-2 text-sm text-gray-700">
              <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
              {feature}
            </div>
          ))}
        </div>
      </div>

      {/* Loading indicator */}
      {checkoutLoading && (
        <div className="flex items-center justify-center gap-2 text-blue-600 mb-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">
            {authLoading ? 'Loading...' : user ? 'Redirecting to checkout...' : 'Redirecting to sign in...'}
          </span>
        </div>
      )}

      {/* Error message */}
      {checkoutError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-red-700 text-sm text-center">{checkoutError}</p>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-gray-500 space-y-1">
        <p>Secure payment powered by Stripe</p>
        <p>Cancel anytime. No commitment.</p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <a href="https://kreativekoala.llc/terms" className="hover:text-gray-700">Terms</a>
          <span>·</span>
          <a href="https://kreativekoala.llc/privacy" className="hover:text-gray-700">Privacy</a>
        </div>
      </div>
    </div>
  );
}
