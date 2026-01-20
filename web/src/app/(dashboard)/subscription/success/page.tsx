'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSubscription } from '@/hooks/useSubscription';
import { CheckCircle, Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import Link from 'next/link';

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const { refresh, isLoading } = useSubscription();

  // Refresh subscription status when page loads
  useEffect(() => {
    if (sessionId) {
      // Give Stripe webhook time to process
      const timer = setTimeout(() => {
        refresh();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [sessionId, refresh]);

  // Redirect if no session_id
  useEffect(() => {
    if (!sessionId && !isLoading) {
      router.push('/subscription');
    }
  }, [sessionId, isLoading, router]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <CheckCircle className="w-10 h-10 text-green-600" />
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-4">
        Welcome to Meeting Mind Pro!
      </h1>

      <p className="text-lg text-gray-600 mb-8">
        Your subscription is now active. You have full access to all premium
        features.
      </p>

      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 mb-8">
        <div className="flex items-center justify-center gap-2 text-blue-600 font-medium mb-4">
          <Sparkles className="w-5 h-5" />
          What you can do now
        </div>
        <ul className="text-left space-y-3 max-w-md mx-auto">
          <li className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
            <span className="text-gray-700">
              Record unlimited meetings, lectures, and conversations
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
            <span className="text-gray-700">
              Get AI-powered summaries and key points automatically
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
            <span className="text-gray-700">
              Ask questions about your recordings with Q&A chat
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
            <span className="text-gray-700">
              Auto-join Zoom, Teams, and Meet calls with meeting bot
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
            <span className="text-gray-700">
              Record and transcribe phone calls
            </span>
          </li>
        </ul>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
        <Link
          href="/recordings"
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-blue-700 transition-colors"
        >
          Go to Recordings
          <ArrowRight className="w-5 h-5" />
        </Link>
        <Link
          href="/meetings"
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-gray-100 text-gray-900 px-6 py-3 rounded-xl font-medium hover:bg-gray-200 transition-colors"
        >
          Connect Calendar
        </Link>
      </div>

      <p className="text-sm text-gray-500 mt-8">
        You can manage your subscription anytime from{' '}
        <Link href="/settings" className="text-blue-600 hover:underline">
          Settings
        </Link>
        .
      </p>
    </div>
  );
}

export default function SubscriptionSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
