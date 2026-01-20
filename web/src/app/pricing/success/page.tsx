'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle, Sparkles, ArrowRight, Loader2, Mic } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const supabase = createClient();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      setIsLoading(false);
    };
    checkAuth();
  }, [supabase.auth]);

  // Redirect if no session_id
  useEffect(() => {
    if (!sessionId && !isLoading) {
      router.push('/pricing');
    }
  }, [sessionId, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

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

      {user ? (
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
      ) : (
        <div className="space-y-4">
          <p className="text-gray-600">
            Sign in to access your Pro features on all your devices.
          </p>
          <Link
            href="/auth?returnTo=/recordings"
            className="inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            Sign In to Continue
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      )}

      <p className="text-sm text-gray-500 mt-8">
        Your subscription will sync automatically to your mobile app when you sign in with the same email.
      </p>
    </div>
  );
}

export default function SubscriptionSuccessPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <nav className="bg-white/80 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
                <Mic className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl">Meeting Mind</span>
            </Link>
          </div>
        </div>
      </nav>

      <Suspense fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      }>
        <SuccessContent />
      </Suspense>
    </div>
  );
}
