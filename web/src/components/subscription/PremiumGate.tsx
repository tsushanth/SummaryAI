'use client';

import { useSubscription } from '@/hooks/useSubscription';
import { Lock, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface PremiumGateProps {
  children: React.ReactNode;
  feature?: keyof ReturnType<typeof useSubscription>['features'];
  fallback?: React.ReactNode;
  showUpgradePrompt?: boolean;
}

/**
 * Wrapper component that gates premium features
 * Shows children if user is subscribed, otherwise shows upgrade prompt
 */
export function PremiumGate({
  children,
  feature,
  fallback,
  showUpgradePrompt = true,
}: PremiumGateProps) {
  const { isPremium, features, isLoading } = useSubscription();

  // Check if specific feature is enabled, or if user has general premium access
  const hasAccess = feature ? features[feature] : isPremium;

  // Show loading state
  if (isLoading) {
    return (
      <div className="animate-pulse bg-gray-100 rounded-lg h-32" />
    );
  }

  // User has access
  if (hasAccess) {
    return <>{children}</>;
  }

  // Show custom fallback
  if (fallback) {
    return <>{fallback}</>;
  }

  // Show default upgrade prompt
  if (!showUpgradePrompt) {
    return null;
  }

  return <UpgradePrompt feature={feature} />;
}

interface UpgradePromptProps {
  feature?: string;
  className?: string;
}

/**
 * Standalone upgrade prompt component
 */
export function UpgradePrompt({ feature, className = '' }: UpgradePromptProps) {
  const featureNames: Record<string, string> = {
    unlimitedRecordings: 'unlimited recordings',
    aiSummaries: 'AI summaries',
    qaChat: 'Q&A chat',
    meetingBot: 'meeting bot',
    phoneRecording: 'phone call recording',
    calendarSync: 'calendar sync',
    exportPdf: 'PDF export',
  };

  const featureName = feature ? featureNames[feature] : 'this feature';

  return (
    <div
      className={`bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-6 text-center ${className}`}
    >
      <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Lock className="w-6 h-6 text-blue-600" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        Upgrade to Pro
      </h3>
      <p className="text-gray-600 mb-4">
        Get access to {featureName} and more with Meeting Mind Pro.
      </p>
      <Link
        href="/subscription"
        className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors"
      >
        <Sparkles className="w-4 h-4" />
        Upgrade Now
      </Link>
      <p className="text-xs text-gray-500 mt-3">
        Save 30% compared to App Store prices
      </p>
    </div>
  );
}

/**
 * Badge to show on locked features
 */
export function ProBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full ${className}`}
    >
      <Sparkles className="w-3 h-3" />
      PRO
    </span>
  );
}

/**
 * Small inline upgrade link
 */
export function UpgradeLink() {
  const { isPremium } = useSubscription();

  if (isPremium) {
    return null;
  }

  return (
    <Link
      href="/subscription"
      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm font-medium"
    >
      <Sparkles className="w-3.5 h-3.5" />
      Upgrade
    </Link>
  );
}
