'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, Loader2, Sparkles, ArrowRight } from 'lucide-react';

function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [isVerifying, setIsVerifying] = useState(true);

  useEffect(() => {
    // Brief delay to allow webhook to process
    const timer = setTimeout(() => {
      setIsVerifying(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, [sessionId]);

  if (isVerifying) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Confirming your subscription...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="max-w-md w-full text-center">
        {/* Success icon */}
        <div className="w-20 h-20 bg-success/15 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-12 h-12 text-success" />
        </div>

        {/* Header */}
        <h1 className="text-3xl font-bold text-foreground mb-3">
          Welcome to Pro!
        </h1>
        <p className="text-lg text-muted-foreground mb-8">
          Your subscription is now active. You have full access to all Meeting Mind Pro features.
        </p>

        {/* Features unlocked */}
        <div className="bg-accent rounded-2xl p-6 mb-8">
          <div className="flex items-center gap-2 justify-center mb-4">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-semibold text-foreground">Features Unlocked</span>
          </div>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li className="flex items-center gap-2 justify-center">
              <CheckCircle className="w-4 h-4 text-success" />
              Unlimited recordings
            </li>
            <li className="flex items-center gap-2 justify-center">
              <CheckCircle className="w-4 h-4 text-success" />
              AI summaries & transcriptions
            </li>
            <li className="flex items-center gap-2 justify-center">
              <CheckCircle className="w-4 h-4 text-success" />
              Q&A chat with your recordings
            </li>
            <li className="flex items-center gap-2 justify-center">
              <CheckCircle className="w-4 h-4 text-success" />
              Meeting bot for Zoom, Teams, Meet
            </li>
            <li className="flex items-center gap-2 justify-center">
              <CheckCircle className="w-4 h-4 text-success" />
              Phone call recording
            </li>
          </ul>
        </div>

        {/* CTA */}
        <Link
          href="/recordings"
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-xl font-medium transition-colors"
        >
          Start using Meeting Mind
          <ArrowRight className="w-5 h-5" />
        </Link>

        <p className="text-sm text-muted-foreground mt-6">
          You can manage your subscription anytime in Settings.
        </p>
      </div>
    </div>
  );
}

export default function SubscriptionSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
          <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
