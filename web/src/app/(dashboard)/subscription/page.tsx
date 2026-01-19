'use client';

import { useSubscription, useCheckout, useCustomerPortal } from '@/hooks/useSubscription';
import {
  CheckCircle,
  Sparkles,
  Loader2,
  CreditCard,
  Calendar,
  Shield,
} from 'lucide-react';

export default function SubscriptionPage() {
  const { subscription, isPremium, status, plan, expiresAt, isLoading } =
    useSubscription();
  const { startCheckout, isLoading: isCheckoutLoading } = useCheckout();
  const { openPortal, isLoading: isPortalLoading } = useCustomerPortal();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm font-medium mb-4">
          <Sparkles className="w-4 h-4" />
          {isPremium ? 'You have Pro' : 'Upgrade to Pro'}
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
          {isPremium
            ? 'Manage Your Subscription'
            : 'Unlock All Features'}
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          {isPremium
            ? 'Thank you for being a Pro member. Manage your subscription below.'
            : 'Get unlimited recordings, AI summaries, meeting bot, and more. Save 30% compared to App Store prices!'}
        </p>
      </div>

      {/* Current Subscription Status (for subscribers) */}
      {isPremium && (
        <div className="bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl p-6 mb-8 text-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-blue-100 text-sm font-medium mb-1">
                Current Plan
              </p>
              <h2 className="text-2xl font-bold mb-2">
                Meeting Mind Pro{' '}
                {plan && (
                  <span className="text-blue-200 font-normal">
                    ({plan.charAt(0).toUpperCase() + plan.slice(1)})
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-4 text-blue-100 text-sm">
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {status === 'trialing'
                    ? 'Trial ends'
                    : 'Renews'}{' '}
                  {expiresAt
                    ? new Date(expiresAt).toLocaleDateString()
                    : 'N/A'}
                </span>
                <span className="flex items-center gap-1">
                  <Shield className="w-4 h-4" />
                  {status === 'trialing' ? 'Free Trial' : 'Active'}
                </span>
              </div>
            </div>
            <button
              onClick={openPortal}
              disabled={isPortalLoading}
              className="flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {isPortalLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4" />
              )}
              Manage Subscription
            </button>
          </div>
        </div>
      )}

      {/* Pricing Cards */}
      {!isPremium && (
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {/* Weekly */}
          <PricingCard
            name="Weekly"
            price="$4.89"
            interval="week"
            appStorePrice="$6.99"
            features={[
              'Unlimited recordings',
              'AI transcription & summaries',
              'All Pro features',
            ]}
            onSelect={() => startCheckout('weekly')}
            isLoading={isCheckoutLoading}
          />

          {/* Monthly */}
          <PricingCard
            name="Monthly"
            price="$10.49"
            interval="month"
            appStorePrice="$14.99"
            features={[
              'Unlimited recordings',
              'AI transcription & summaries',
              'Q&A with your recordings',
              'Meeting bot for Zoom/Teams/Meet',
              'Phone call recording',
            ]}
            onSelect={() => startCheckout('monthly')}
            isLoading={isCheckoutLoading}
          />

          {/* Yearly - Highlighted */}
          <PricingCard
            name="Yearly"
            price="$48.99"
            interval="year"
            appStorePrice="$69.99"
            monthlyEquivalent="$4.08/month"
            highlighted
            badge="BEST VALUE"
            trialDays={7}
            features={[
              'Unlimited recordings',
              'AI transcription & summaries',
              'Q&A with your recordings',
              'Meeting bot for Zoom/Teams/Meet',
              'Phone call recording',
              'Priority support',
            ]}
            onSelect={() => startCheckout('yearly')}
            isLoading={isCheckoutLoading}
          />
        </div>
      )}

      {/* Features Grid */}
      <div className="bg-gray-50 rounded-2xl p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">
          What&apos;s Included in Pro
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureItem>Unlimited recording time</FeatureItem>
          <FeatureItem>AI-powered transcription</FeatureItem>
          <FeatureItem>Smart summaries & key points</FeatureItem>
          <FeatureItem>Q&A chat with recordings</FeatureItem>
          <FeatureItem>Meeting bot (Zoom, Teams, Meet)</FeatureItem>
          <FeatureItem>Phone call recording</FeatureItem>
          <FeatureItem>Calendar integration</FeatureItem>
          <FeatureItem>Export to PDF & Markdown</FeatureItem>
          <FeatureItem>Priority support</FeatureItem>
        </div>
      </div>

      {/* FAQ or trust badges */}
      <div className="mt-8 text-center text-sm text-gray-500">
        <p>
          Secure payment powered by Stripe. Cancel anytime.
        </p>
        <p className="mt-1">
          Questions? Contact support@meetingmind.org
        </p>
      </div>
    </div>
  );
}

interface PricingCardProps {
  name: string;
  price: string;
  interval: string;
  appStorePrice: string;
  monthlyEquivalent?: string;
  highlighted?: boolean;
  badge?: string;
  trialDays?: number;
  features: string[];
  onSelect: () => void;
  isLoading: boolean;
}

function PricingCard({
  name,
  price,
  interval,
  appStorePrice,
  monthlyEquivalent,
  highlighted,
  badge,
  trialDays,
  features,
  onSelect,
  isLoading,
}: PricingCardProps) {
  const baseClasses = highlighted
    ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white'
    : 'bg-white border border-gray-200 text-gray-900';

  const buttonClasses = highlighted
    ? 'bg-white text-blue-600 hover:bg-blue-50'
    : 'bg-blue-600 text-white hover:bg-blue-700';

  const featureCheckClasses = highlighted
    ? 'text-blue-200'
    : 'text-green-500';

  const subtextClasses = highlighted ? 'text-blue-200' : 'text-gray-500';

  return (
    <div className={`rounded-2xl p-6 relative ${baseClasses}`}>
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-900 text-xs font-bold px-3 py-1 rounded-full">
          {badge}
        </div>
      )}

      <h3 className="text-lg font-semibold mb-2">{name}</h3>

      <div className="mb-4">
        <span className="text-4xl font-bold">{price}</span>
        <span className={subtextClasses}>/{interval}</span>
        {monthlyEquivalent && (
          <div className={`text-sm ${subtextClasses} mt-1`}>
            Just {monthlyEquivalent}
          </div>
        )}
      </div>

      <div className={`text-sm ${subtextClasses} mb-4`}>
        <span className="line-through">{appStorePrice}</span> on App Store
        <span className="ml-1 text-green-400 font-medium">Save 30%</span>
      </div>

      {trialDays && (
        <div
          className={`text-sm ${subtextClasses} mb-4 flex items-center gap-1`}
        >
          <Shield className="w-4 h-4" />
          {trialDays}-day free trial
        </div>
      )}

      <ul className="space-y-2 mb-6">
        {features.map((feature, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <CheckCircle
              className={`w-4 h-4 mt-0.5 flex-shrink-0 ${featureCheckClasses}`}
            />
            {feature}
          </li>
        ))}
      </ul>

      <button
        onClick={onSelect}
        disabled={isLoading}
        className={`w-full py-3 rounded-xl font-medium transition-colors disabled:opacity-50 ${buttonClasses}`}
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        ) : trialDays ? (
          `Start ${trialDays}-Day Free Trial`
        ) : (
          'Subscribe Now'
        )}
      </button>
    </div>
  );
}

function FeatureItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-gray-700">
      <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}
