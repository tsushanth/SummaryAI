import { Suspense } from 'react';
import { GoogleSignIn } from '@/components/auth/GoogleSignIn';
import { RibbonMark } from '@/components/ui/ribbon-mark';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

export default function AuthPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 sm:p-8">
        <RibbonMark className="h-10 w-10" />
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">Sign in to MeetingMind</h1>
        <p className="mt-2 text-base leading-relaxed text-muted-foreground">
          Transcripts, summaries and action items for every meeting, on any device.
        </p>
        <div className="mt-6 space-y-4">
          <Suspense
            fallback={
              <div className="flex h-12 items-center justify-center" role="status" aria-label="Loading sign-in">
                <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              </div>
            }
          >
            <GoogleSignIn />
          </Suspense>
          <p className="text-sm text-muted-foreground">
            By continuing, you agree to our{' '}
            <Link href="/terms" className="rounded-sm underline underline-offset-2 hover:text-foreground">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="rounded-sm underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
      <Link href="/" className="flex min-h-[44px] items-center rounded-sm text-sm text-muted-foreground hover:text-foreground">
        Back to home
      </Link>
    </main>
  );
}
