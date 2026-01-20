'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle,
  Sparkles,
  Loader2,
  Shield,
  Mic,
  ArrowLeft,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { createCheckoutSession } from '@/lib/api/subscription';

export default function PublicSubscriptionPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      setIsLoading(false);
    };
    getUser();
  }, [supabase.auth]);

  const handleCheckout = async (planType: 'weekly' | 'monthly' | 'yearly') => {
    if (!user) {
      // Redirect to auth with return URL
      router.push(`/auth?returnTo=/subscription&plan=${planType}`);
      return;
    }

    setCheckoutLoading(planType);
    try {
      const { checkoutUrl } = await createCheckoutSession(planType);
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <nav className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
                <Mic className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl">Meeting Mind</span>
            </Link>
            <div className="flex items-center gap-3">
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              ) : user ? (
                <Link
                  href="/recordings"
                  className="text-gray-600 hover:text-gray-900 text-sm font-medium"
                >
                  Go to App
                </Link>
              ) : (
                <>
                  <Link
                    href="/auth"
                    className="text-gray-600 hover:text-gray-900 text-sm font-medium"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/auth"
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Get Started Free
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Back Link */}
      <div className="max-w-5xl mx-auto px-4 pt-6">
        <Link
          href="/"
          className="inline-flex items-center text-gray-500 hover:text-gray-700 text-sm"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Home
        </Link>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-green-50 text-green-700 px-4 py-2 rounded-full text-sm font-medium mb-4">
            <Sparkles className="w-4 h-4" />
            Save 30% vs App Store
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Upgrade to Meeting Mind Pro
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Get unlimited recordings, AI summaries, meeting bot, and more.
            Subscribe on web and save 30% compared to App Store prices!
          </p>
        </div>

        {/* Pricing Cards */}
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
            onSelect={() => handleCheckout('weekly')}
            isLoading={checkoutLoading === 'weekly'}
            disabled={!!checkoutLoading}
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
            onSelect={() => handleCheckout('monthly')}
            isLoading={checkoutLoading === 'monthly'}
            disabled={!!checkoutLoading}
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
            onSelect={() => handleCheckout('yearly')}
            isLoading={checkoutLoading === 'yearly'}
            disabled={!!checkoutLoading}
          />
        </div>

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
            <FeatureItem>36+ languages supported</FeatureItem>
          </div>
        </div>

        {/* Trust badges */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Secure payment powered by Stripe. Cancel anytime.</p>
          <p className="mt-1">
            Questions? Contact support@meetingmind.org
          </p>
        </div>

        {/* Sign in prompt for non-authenticated users */}
        {!isLoading && !user && (
          <div className="mt-8 text-center">
            <p className="text-gray-600 mb-2">
              Already have an account?{' '}
              <Link href="/auth?returnTo=/subscription" className="text-blue-600 hover:underline font-medium">
                Sign in
              </Link>{' '}
              to subscribe.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-gray-100 py-8 mt-16">
        <div className="max-w-5xl mx-auto px-4 text-center text-sm text-gray-500">
          <p>&copy; {new Date().getFullYear()} Meeting Mind. All rights reserved.</p>
        </div>
      </footer>
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
  disabled?: boolean;
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
  disabled,
}: PricingCardProps) {
  const baseClasses = highlighted
    ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white'
    : 'bg-white border border-gray-200 text-gray-900';

  const buttonClasses = highlighted
    ? 'bg-white text-blue-600 hover:bg-blue-50'
    : 'bg-blue-600 text-white hover:bg-blue-700';

  const featureCheckClasses = highlighted ? 'text-blue-200' : 'text-green-500';

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
        disabled={isLoading || disabled}
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
